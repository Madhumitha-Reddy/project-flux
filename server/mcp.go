package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	application "github.com/flux-pkm/server/internal/app"
	"github.com/flux-pkm/server/internal/capability"
	"github.com/flux-pkm/server/internal/config"
	"github.com/flux-pkm/server/internal/daemonclient"
	"github.com/flux-pkm/server/internal/mcpserver"
	"github.com/flux-pkm/server/internal/runtimecoord"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func runMCPBridge(arguments []string) error {
	flags := flag.NewFlagSet("flux mcp", flag.ContinueOnError)
	vaultPath := flags.String("vault", "", "vault directory exposed to this MCP client")
	clientID := flags.String("client", "local-mcp", "stable MCP client identity")
	modeValue := flags.String("mode", string(capability.ReadOnly), "read_only, guided_write, or trusted_workspace")
	appData := flags.String("app-data", "", "Flux app-data directory")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *vaultPath == "" {
		return errors.New("--vault is required")
	}
	mode := capability.ApprovalMode(*modeValue)
	if mode != capability.ReadOnly && mode != capability.Guided && mode != capability.Trusted {
		return errors.New("--mode must be read_only, guided_write, or trusted_workspace")
	}
	cfg := config.Load()
	if *appData != "" {
		cfg.AppDataDir = *appData
	}
	client, err := connectDaemon(context.Background(), cfg.AppDataDir)
	if err != nil {
		return err
	}
	vault, err := client.OpenVault(context.Background(), *vaultPath)
	if err != nil {
		return fmt.Errorf("open MCP vault: %w", err)
	}
	grants := map[capability.Capability]bool{capability.VaultRead: true}
	if mode != capability.ReadOnly {
		grants[capability.VaultWrite] = true
		grants[capability.VaultMove] = true
		grants[capability.VaultDelete] = true
	}
	var approver capability.Approver
	if mode == capability.Guided {
		approver = mcpserver.ElicitationApprover
	}
	policy, err := capability.NewPolicy(capability.Principal{
		ID: *clientID, Mode: mode,
		Vaults: map[string]bool{vault.ID: true}, Capabilities: grants,
	}, approver)
	if err != nil {
		return err
	}
	server := mcpserver.New(client, policy, application.Version)
	runContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	go keepDaemonAlive(runContext, client, vault.ID)
	return server.Run(runContext, &mcp.StdioTransport{})
}

func keepDaemonAlive(ctx context.Context, client *daemonclient.Client, vaultID string) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = client.VaultRevision(vaultID)
		}
	}
}

func connectDaemon(ctx context.Context, appDataDirectory string) (*daemonclient.Client, error) {
	descriptorPath := filepath.Join(appDataDirectory, "runtime", "daemon.json")
	if client := descriptorClient(ctx, descriptorPath); client != nil {
		return client, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	command := exec.Command(executable, "serve")
	command.Env = append(os.Environ(),
		"ENVIRONMENT=desktop",
		"HOST=127.0.0.1",
		"PORT=0",
		"FLUX_APP_DATA_DIR="+appDataDirectory,
		"FLUX_DESKTOP_TOKEN=",
		"FLUX_DAEMON_IDLE_TIMEOUT=2m",
	)
	// Never let daemon output corrupt MCP stdout.
	command.Stdout = os.Stderr
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	_ = command.Process.Release()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if client := descriptorClient(ctx, descriptorPath); client != nil {
			return client, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, errors.New("Flux daemon did not become ready")
}

func descriptorClient(ctx context.Context, descriptorPath string) *daemonclient.Client {
	descriptor, err := runtimecoord.ReadDescriptor(descriptorPath)
	if err != nil {
		return nil
	}
	client, err := daemonclient.New(descriptor.Origin, descriptor.Token)
	if err != nil {
		return nil
	}
	check, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	if _, err := client.Status(check); err != nil {
		return nil
	}
	return client
}
