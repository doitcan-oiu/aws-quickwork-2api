package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"quickwork-openai/internal/accounts"
	"quickwork-openai/internal/admin"
	"quickwork-openai/internal/config"
	"quickwork-openai/internal/errlog"
	"quickwork-openai/internal/oauth"
	"quickwork-openai/internal/proxy"
	"quickwork-openai/internal/store"
	"quickwork-openai/web"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		return serve(nil)
	}
	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "login":
		return login(args[1:])
	case "accounts", "list":
		return listAccounts(args[1:])
	case "refresh":
		return refreshAccounts(args[1:])
	case "logout":
		return logout(args[1:])
	case "help", "-h", "--help":
		usage()
		return 0
	default:
		if strings.HasPrefix(args[0], "-") {
			return serve(args)
		}
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		usage()
		return 2
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `quickwork-openai - Amazon Quick to OpenAI-compatible API

Usage:
  quickproxy serve    [-config config.json] [-addr HOST:PORT]
  quickproxy login    [-config config.json] [-provider social|enterprise|gateway|social_gateway]
                      [-stage prod|beta|integ|dev] [-region REGION] [-port 18080]
                      [-timeout 1h] [-open] [-manual]
  quickproxy accounts [-config config.json]
  quickproxy refresh  [-config config.json] [-account ID]
  quickproxy logout   [-config config.json] (-all | -account ID)

Running without a subcommand is equivalent to "serve".
Open /admin/ on the service address to manage accounts in a browser.

config.json is created with defaults on first use. Accounts are stored in the
SQLite database named by "database" in config.json. When multiple accounts are
present, requests rotate through them round-robin.
`)
}

type commandRuntime struct {
	cfg    *config.Config
	store  *store.Store
	ctx    context.Context
	output io.Closer
}

func openRuntime(path, command string) (*commandRuntime, error) {
	cfg, err := config.Load(path)
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	logger, output, err := errlog.Open(cfg.ErrorLog, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error log unavailable:", err)
		logger, output, _ = errlog.Open("", os.Stderr)
	}
	logger = logger.With("command", command)
	st, err := store.Open(cfg.Database)
	if err != nil {
		logger.Error("open account database", "cause", errlog.Cause(err))
		output.Close()
		return nil, fmt.Errorf("open database %s: %w", cfg.Database, err)
	}
	return &commandRuntime{cfg, st, errlog.WithLogger(context.Background(), logger), output}, nil
}

func (app *commandRuntime) close() {
	if err := app.store.Close(); err != nil {
		errlog.From(app.ctx).Error("close account database", "cause", errlog.Cause(err))
	}
	app.output.Close()
}

func serve(args []string) int {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "path to config.json")
	addr := fs.String("addr", "", "override the configured HTTP listen address")
	_ = fs.Parse(args)

	app, err := openRuntime(*configPath, "serve")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer app.close()
	cfg, st := app.cfg, app.store

	mgr := accounts.New(st, cfg)
	count, err := mgr.EnabledCount(app.ctx)
	if err != nil {
		errlog.From(app.ctx).Error("count enabled accounts", "cause", errlog.Cause(err))
		return 1
	}
	if *addr != "" {
		cfg.Addr = *addr
	}
	handler := serviceHandler(cfg, st, mgr, os.Getenv("QUICKPROXY_ADMIN_TOKEN"))
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		BaseContext:       func(net.Listener) context.Context { return app.ctx },
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("quickwork-openai listening on %s (config=%s db=%s accounts=%d auth=%v)",
		cfg.Addr, cfg.Path, cfg.Database, count, len(cfg.APIKeys) > 0)
	log.Print("management console: /admin/")
	if count == 0 {
		log.Printf("no accounts stored; add an account in /admin/ or run `quickproxy login`")
	}

	stop, cancel := signal.NotifyContext(app.ctx, os.Interrupt, syscall.SIGTERM)
	defer cancel()
	listenErr := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
			cancel()
		}
	}()

	<-stop.Done()
	log.Printf("shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		errlog.From(app.ctx).Error("shut down HTTP server", "cause", errlog.Cause(err))
		return 1
	}
	select {
	case err := <-listenErr:
		errlog.From(app.ctx).Error("listen for HTTP requests", "address", cfg.Addr, "cause", errlog.Cause(err))
		return 1
	default:
		return 0
	}
}

func serviceHandler(cfg *config.Config, st *store.Store, mgr *accounts.Manager, adminToken string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/admin/api/", admin.Protect(admin.NewAPI(cfg, st, mgr), adminToken))
	mux.Handle("/admin/", web.Handler())
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})
	mux.Handle("/", proxy.NewServer(cfg, mgr).Handler())
	return mux
}

func login(args []string) int {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "path to config.json")
	provider := fs.String("provider", "", "social, enterprise, gateway or social_gateway (default from config)")
	stage := fs.String("stage", "", "prod, beta, integ or dev (default from config)")
	region := fs.String("region", "", "IDC region (social) or enterprise discovery region prefix")
	port := fs.Int("port", 0, "localhost callback port (default from config)")
	timeout := fs.Duration("timeout", 0, "wait duration for the browser callback (default from config)")
	open := fs.Bool("open", false, "open the login URL in the default browser")
	manual := fs.Bool("manual", false, "paste browser callback URLs manually (for servers without a reachable localhost)")
	_ = fs.Parse(args)

	app, err := openRuntime(*configPath, "login")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer app.close()
	cfg, st := app.cfg, app.store

	if *provider == "" {
		*provider = cfg.OAuth.Provider
	}
	if *stage == "" {
		*stage = cfg.OAuth.BuildStage
	}
	if *port == 0 {
		*port = cfg.OAuth.CallbackPort
	}
	if *timeout == 0 {
		*timeout = cfg.OAuth.Timeout.Duration()
	}

	ctx, cancel := signal.NotifyContext(app.ctx, os.Interrupt, syscall.SIGTERM)
	defer cancel()
	logger := log.New(os.Stdout, "[login] ", 0)
	opts := oauth.LoginOptions{
		Provider:    *provider,
		Stage:       *stage,
		Region:      *region,
		Port:        *port,
		Timeout:     *timeout,
		AppVersion:  cfg.AppVersion,
		OpenBrowser: *open,
		Logf:        logger.Printf,
	}
	var acct *store.Account
	if *manual {
		acct, err = oauth.LoginManual(ctx, opts, st, os.Stdin, os.Stdout)
	} else {
		acct, err = oauth.Login(ctx, opts, st)
	}
	if err != nil {
		errlog.From(ctx).Error("login failed", "cause", errlog.Cause(err))
		fmt.Fprintln(os.Stderr, "[login] failed:", err)
		return 1
	}
	fmt.Printf("account %d ready: %s (%s, %s)\n", acct.ID, displayAccount(acct), acct.Provider, acct.WSHost)
	return 0
}

func listAccounts(args []string) int {
	fs := flag.NewFlagSet("accounts", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "path to config.json")
	_ = fs.Parse(args)

	app, err := openRuntime(*configPath, "accounts")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer app.close()
	st := app.store

	list, err := st.List(app.ctx)
	if err != nil {
		errlog.From(app.ctx).Error("list accounts", "cause", errlog.Cause(err))
		return 1
	}
	if len(list) == 0 {
		fmt.Println("no accounts; run `quickproxy login`")
		return 0
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tEMAIL\tPROVIDER\tSTAGE\tREGION\tEXPIRES\tUSES\tSTATUS")
	now := time.Now()
	for i := range list {
		a := &list[i]
		status := "ready"
		if a.Disabled {
			status = "disabled"
		} else if a.ExpiresAt > 0 && a.ExpiresAt <= now.Unix() {
			status = "expired"
		}
		if a.LastError != "" {
			status += " (" + a.LastError + ")"
		}
		fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%d\t%s\n",
			a.ID, displayAccount(a), a.Provider, a.BuildStage, a.Region,
			formatEpoch(a.ExpiresAt), a.UseCount, status)
	}
	_ = tw.Flush()
	return 0
}

func refreshAccounts(args []string) int {
	fs := flag.NewFlagSet("refresh", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "path to config.json")
	accountID := fs.Int64("account", 0, "refresh only this account ID (default: all)")
	_ = fs.Parse(args)

	app, err := openRuntime(*configPath, "refresh")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer app.close()
	cfg, st := app.cfg, app.store

	mgr := accounts.New(st, cfg)
	ctx, cancel := signal.NotifyContext(app.ctx, os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if *accountID > 0 {
		a, err := mgr.RefreshOne(ctx, *accountID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "account %d: %v\n", *accountID, err)
			return 1
		}
		fmt.Printf("account %d refreshed: %s expires %s\n", a.ID, displayAccount(a), formatEpoch(a.ExpiresAt))
		return 0
	}

	results, err := mgr.RefreshAll(ctx)
	if err != nil {
		errlog.From(ctx).Error("refresh accounts", "cause", errlog.Cause(err))
		return 1
	}
	if len(results) == 0 {
		fmt.Println("no accounts; run `quickproxy login`")
		return 0
	}
	failed := 0
	for _, res := range results {
		if res.Err != nil {
			failed++
			id := int64(0)
			if res.Account != nil {
				id = res.Account.ID
			}
			fmt.Fprintf(os.Stderr, "account %d: %v\n", id, res.Err)
			continue
		}
		fmt.Printf("account %d refreshed: %s expires %s\n",
			res.Account.ID, displayAccount(res.Account), formatEpoch(res.Account.ExpiresAt))
	}
	if failed > 0 {
		return 1
	}
	return 0
}

func logout(args []string) int {
	fs := flag.NewFlagSet("logout", flag.ExitOnError)
	configPath := fs.String("config", "config.json", "path to config.json")
	accountID := fs.Int64("account", 0, "delete only this account ID")
	all := fs.Bool("all", false, "delete every stored account")
	_ = fs.Parse(args)

	if *accountID <= 0 && !*all {
		fmt.Fprintln(os.Stderr, "logout requires -all or -account ID")
		return 2
	}
	app, err := openRuntime(*configPath, "logout")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer app.close()
	st := app.store

	ctx := app.ctx
	if *all {
		n, err := st.DeleteAll(ctx)
		if err != nil {
			errlog.From(ctx).Error("remove accounts", "cause", errlog.Cause(err))
			return 1
		}
		fmt.Printf("removed %d account(s)\n", n)
		return 0
	}
	ok, err := st.Delete(ctx, *accountID)
	if err != nil {
		errlog.From(ctx).Error("remove accounts", "cause", errlog.Cause(err))
		return 1
	}
	if !ok {
		errlog.From(ctx).Error("remove account", "account_id", *accountID, "cause", "record not found")
		return 1
	}
	fmt.Printf("removed account %d\n", *accountID)
	return 0
}

func displayAccount(a *store.Account) string {
	for _, v := range []string{a.Email, a.AccountName, a.AWSAccountID} {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return "-"
}

func formatEpoch(v int64) string {
	if v <= 0 {
		return "unknown"
	}
	return time.Unix(v, 0).Local().Format("2006-01-02 15:04")
}
