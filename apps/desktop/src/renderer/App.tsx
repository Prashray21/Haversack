import { useCallback, useEffect, useState } from "react";
import type {
  EnvInfo,
  IngestResult,
  Inventory,
  McpPlanStep,
  McpTestResult,
  PlanStep,
  SkillPlanStep,
} from "./types";

/**
 * Local mode (PRD L1–L7): inventory, add skill (folder/zip/git), add MCP,
 * plan preview with exact writes/commands, apply, undo, uninstall ours only,
 * secret values via the protected store, MCP connection test with per-run
 * approval. All state changes flow through main → utility process → core.
 */

type Tab = "inventory" | "add-skill" | "add-mcp" | "secrets";

function useInvoke() {
  return useCallback((op: string, payload: unknown) => window.haversack.invoke(op, payload), []);
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="card error">
      {message}
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="card muted" aria-busy="true">
      {text}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="card muted">{text}</div>;
}

export function App() {
  const invoke = useInvoke();
  const [env, setEnv] = useState<EnvInfo | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("inventory");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [pendingPlan, setPendingPlan] = useState<PlanStep[] | undefined>(undefined);

  useEffect(() => {
    invoke("app.env", {})
      .then((result) => setEnv(result as EnvInfo))
      .catch((err: Error) => setError(err.message));
  }, [invoke]);

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  if (env === undefined) {
    return (
      <main className="app">
        <h1>Haversack</h1>
        {error !== undefined ? <ErrorBox message={error} /> : <Loading text="Starting…" />}
      </main>
    );
  }

  return (
    <main className="app">
      <h1>{env.productName}</h1>
      <p className="subtitle">Local mode — everything stays on this machine. v{env.appVersion}</p>
      <nav aria-label="Sections" className="tabs">
        {(
          [
            ["inventory", "Inventory"],
            ["add-skill", "Add skill"],
            ["add-mcp", "Add MCP server"],
            ["secrets", "Secrets"],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "tab active" : "tab"}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => {
              setTab(key);
              setPendingPlan(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {busy !== undefined && <Loading text={busy} />}
      {error !== undefined && <ErrorBox message={error} />}
      {tab === "inventory" && <InventoryTab env={env} invoke={invoke} withBusy={withBusy} />}
      {tab === "add-skill" && (
        <AddSkillTab
          env={env}
          invoke={invoke}
          withBusy={withBusy}
          onPlanned={(steps) => {
            setPendingPlan(steps);
            setTab("inventory");
          }}
        />
      )}
      {tab === "add-mcp" && <AddMcpTab env={env} invoke={invoke} withBusy={withBusy} onPlanned={(steps) => { setPendingPlan(steps); setTab("inventory"); }} />}
      {tab === "secrets" && <SecretsTab invoke={invoke} withBusy={withBusy} />}
      {pendingPlan !== undefined && (
        <PlanPreview
          steps={pendingPlan}
          invoke={invoke}
          withBusy={withBusy}
          onClose={() => setPendingPlan(undefined)}
          onApplied={() => setPendingPlan(undefined)}
        />
      )}
    </main>
  );
}

/* ── Inventory ──────────────────────────────────────────────────────── */

function InventoryTab({
  env,
  invoke,
  withBusy,
}: {
  env: EnvInfo;
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [inventory, setInventory] = useState<Inventory | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const result = (await invoke("inventory.list", { home: env.home })) as Inventory;
    setInventory(result);
  }, [env.home, invoke]);

  useEffect(() => {
    withBusy("Reading inventory…", refresh).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const recordsJson = window.localStorage.getItem("haversack-applied-records");
  const appliedRecords: unknown[] = recordsJson === null ? [] : (JSON.parse(recordsJson) as unknown[]);

  const uninstall = (kind: "skill" | "mcp", name: string, scope: string, force: boolean) =>
    withBusy(`Uninstalling ${name}…`, async () => {
      const op = kind === "skill" ? "uninstall.skill" : "uninstall.mcp";
      await invoke(op, { name, scope, home: env.home, force });
      setNotice(`${name} uninstalled.`);
      await refresh();
    });

  return (
    <section aria-label="Inventory">
      {notice !== undefined && (
        <div className="card ok" role="status">
          {notice}{" "}
          <button type="button" className="link" onClick={() => setNotice(undefined)}>
            dismiss
          </button>
        </div>
      )}
      {inventory === undefined ? (
        <Loading text="Reading inventory…" />
      ) : (
        <>
          {inventory.configErrors.map((configError) => (
            <div key={configError} className="card error">
              Config problem: {configError}
            </div>
          ))}
          <h2>Skills</h2>
          {inventory.skills.length === 0 ? (
            <Empty text="No skills installed for Claude Code yet. Use “Add skill”." />
          ) : (
            <ul className="entries">
              {inventory.skills.map((entry) => (
                <li key={`${entry.scope}:${entry.name}`} className="card entry">
                  <div className="entry-head">
                    <strong>{entry.name}</strong>
                    <span className={`pill ${entry.ours ? "ours" : "foreign"}`}>{entry.ours ? "installed by Haversack" : "not ours"}</span>
                    <span className="pill">{entry.scope} scope</span>
                    {entry.symlink === true && <span className="pill warn">symlink — ignored</span>}
                  </div>
                  <div className="muted small mono">{entry.dir}</div>
                  {entry.ours && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Uninstall skill "${entry.name}" (${entry.scope})?`)) {
                          void uninstall("skill", entry.name, entry.scope, false);
                        }
                      }}
                    >
                      Uninstall
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <h2>MCP servers</h2>
          {inventory.mcp.length === 0 ? (
            <Empty text="No MCP servers configured for Claude Code yet. Use “Add MCP server”." />
          ) : (
            <ul className="entries">
              {inventory.mcp.map((entry) => (
                <li key={`${entry.scope}:${entry.name}`} className="card entry">
                  <div className="entry-head">
                    <strong>{entry.name}</strong>
                    <span className={`pill ${entry.ours ? "ours" : "foreign"}`}>{entry.ours ? "installed by Haversack" : "not ours"}</span>
                    <span className="pill">{entry.scope} scope</span>
                  </div>
                  <div className="muted small mono">
                    {entry.entry.command !== undefined
                      ? [entry.entry.command, ...(entry.entry.args ?? [])].join(" ")
                      : entry.entry.url}
                  </div>
                  <div className="row">
                    {entry.entry.command !== undefined && (
                      <button
                        type="button"
                        onClick={() =>
                          void withBusy("Running connection test…", async () => {
                            const argv = [entry.entry.command as string, ...(entry.entry.args ?? [])];
                            const result = (await invoke("mcp.test", { argv, label: entry.name })) as McpTestResult;
                            if (!result.approved) {
                              setNotice("Connection test canceled — nothing ran.");
                              return;
                            }
                            setNotice(
                              `Connection test: exit ${String(result.exitCode)}${result.stderr !== "" ? ` — ${result.stderr.slice(0, 200)}` : " (no output is normal for servers that wait on stdin)"}`,
                            );
                          })
                        }
                      >
                        Test connection
                      </button>
                    )}
                    {entry.ours && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Uninstall MCP server "${entry.name}" (${entry.scope})?`)) {
                            void uninstall("mcp", entry.name, entry.scope, false);
                          }
                        }}
                      >
                        Uninstall
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {appliedRecords.length > 0 && (
            <div className="card">
              <strong>{String(appliedRecords.length)}</strong> applied change(s) from this session can be undone.
              <button
                type="button"
                className="row-gap"
                onClick={() =>
                  void withBusy("Undoing…", async () => {
                    await invoke("undo.run", { records: appliedRecords });
                    window.localStorage.removeItem("haversack-applied-records");
                    setNotice("Changes undone.");
                    await refresh();
                  })
                }
              >
                Undo all
              </button>
            </div>
          )}
        </>
      )}
      {/* plan preview opens over the inventory tab */}
    </section>
  );
}

/** Rendered by App when a plan is pending; kept out of tab state. */
function PlanPreview(props: {
  steps: PlanStep[];
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
  onClose: () => void;
  onApplied: () => void;
}) {
  return (
    <div role="dialog" aria-label="Plan preview — exact changes" className="modal-backdrop">
      <PlanPreviewBody {...props} />
    </div>
  );
}


function PlanPreviewBody({
  steps,
  invoke,
  withBusy,
  onClose,
  onApplied,
}: {
  steps: PlanStep[];
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
  onClose: () => void;
  onApplied: () => void;
}) {
  return (
    <div className="modal card" aria-live="polite">
      <h2>Review exact changes before applying</h2>
      {steps.map((step, index) => (
        <div key={index} className="plan-step">
          {step.kind === "skill" ? <SkillPlanView step={step} /> : <McpPlanView step={step} />}
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() =>
            void withBusy("Applying…", async () => {
              const records = (await invoke("apply.run", { steps })) as unknown[];
              const previous = window.localStorage.getItem("haversack-applied-records");
              const merged = previous === null ? records : [...(JSON.parse(previous) as unknown[]), ...records];
              window.localStorage.setItem("haversack-applied-records", JSON.stringify(merged));
              onApplied();
            })
          }
        >
          Apply these changes
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SkillPlanView({ step }: { step: SkillPlanStep }) {
  return (
    <div>
      <strong>
        Skill “{step.name}” ({step.action}, {step.scope} scope)
      </strong>
      <div className="muted small mono">{step.targetRoot}</div>
      {step.writes.length === 0 ? (
        <div className="muted small">Already identical — nothing to write.</div>
      ) : (
        <table className="plan-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {step.writes.map((write) => (
              <tr key={write.relPath}>
                <td className="mono">{write.relPath}</td>
                <td className="mono muted">{write.before === "absent" ? "(absent)" : `sha256 ${write.before.sha256.slice(0, 10)}…`}</td>
                <td className="mono">sha256 {write.afterSha256.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function McpPlanView({ step }: { step: McpPlanStep }) {
  return (
    <div>
      <strong>
        MCP server “{step.name}” ({step.action}, {step.scope} scope)
      </strong>
      <div className="muted small mono">{step.configPath}</div>
      <div className="small">
        {step.action === "update" && "⚠ This CHANGES an existing command — a person must approve on this machine."}
        {step.secretsInline && " ⚠ Real secret values will be written to the local machine config (never uploaded)."}
      </div>
      <pre className="mono small plan-code">{step.cliArgv.map((arg) => JSON.stringify(arg)).join(" ")}</pre>
      <details>
        <summary className="small muted">entry JSON</summary>
        <pre className="mono small plan-code">{step.entryJson}</pre>
      </details>
    </div>
  );
}

/* ── Add skill ──────────────────────────────────────────────────────── */

function AddSkillTab({
  env,
  invoke,
  withBusy,
  onPlanned,
}: {
  env: EnvInfo;
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
  onPlanned: (steps: PlanStep[]) => void;
}) {
  const [mode, setMode] = useState<"folder" | "zip" | "git">("folder");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [result, setResult] = useState<IngestResult | undefined>(undefined);

  const ingest = (payload: Record<string, unknown>, op: string) =>
    void withBusy("Ingesting skill…", async () => {
      const ingestResult = (await invoke(op, payload)) as IngestResult;
      setResult(ingestResult);
    });

  return (
    <section aria-label="Add skill">
      <fieldset>
        <legend>Source</legend>
        {(["folder", "zip", "git"] as const).map((key) => (
          <label key={key} className="row-gap">
            <input type="radio" name="skill-source" checked={mode === key} onChange={() => setMode(key)} /> {key}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Install scope</legend>
        <label className="row-gap">
          <input type="radio" name="skill-scope" checked={scope === "user"} onChange={() => setScope("user")} /> user (this machine, all
          projects)
        </label>
        <label className="row-gap">
          <input type="radio" name="skill-scope" checked={scope === "project"} onChange={() => setScope("project")} /> project (into a
          repository — you commit it)
        </label>
      </fieldset>

      {mode === "folder" && (
        <div className="row">
          <button
            type="button"
            onClick={() =>
              void withBusy("Picking folder…", async () => {
                const picked = (await invoke("dialog.pickFolder", { title: "Pick the skill folder" })) as { canceled: boolean; path?: string };
                if (!picked.canceled && picked.path !== undefined) ingest({ dir: picked.path }, "ingest.skill.folder");
              })
            }
          >
            Pick folder…
          </button>
        </div>
      )}
      {mode === "zip" && (
        <div className="row">
          <button
            type="button"
            onClick={() =>
              void withBusy("Picking zip…", async () => {
                const picked = (await invoke("dialog.pickZip", { title: "Pick the skill zip" })) as { canceled: boolean; fileBase64: string };
                if (!picked.canceled) ingest({ fileBase64: picked.fileBase64, name: window.prompt("Skill name (command name):") ?? "" }, "ingest.skill.zip");
              })
            }
          >
            Pick zip…
          </button>
        </div>
      )}
      {mode === "git" && <GitIngestForm onIngest={(url, commit) => ingest({ url, commit }, "ingest.skill.git")} />}

      {result !== undefined && <IngestResultView result={result} scope={scope} env={env} invoke={invoke} withBusy={withBusy} onPlanned={onPlanned} />}
    </section>
  );
}

function GitIngestForm({ onIngest }: { onIngest: (url: string, commit: string) => void }) {
  const [url, setUrl] = useState("");
  const [commit, setCommit] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onIngest(url, commit.trim());
      }}
    >
      <label className="row-gap">
        Git URL
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/team/skill-repo" required />
      </label>
      <label className="row-gap">
        Pinned commit (40/64-char sha — required)
        <input value={commit} onChange={(event) => setCommit(event.target.value)} placeholder="a1b2c3…" required pattern="[0-9a-fA-F]{40}|[0-9a-fA-F]{64}" />
      </label>
      <button type="submit">Fetch and inspect</button>
    </form>
  );
}

function IngestResultView({
  result,
  scope,
  env,
  invoke,
  withBusy,
  onPlanned,
}: {
  result: IngestResult;
  scope: "user" | "project";
  env: EnvInfo;
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
  onPlanned: (steps: PlanStep[]) => void;
}) {
  return (
    <div className="card">
      <strong>
        Inspected “{result.item.name}” — {result.item.files.length} file(s), sha256 {result.item.contentHash.slice(0, 10)}…
      </strong>
      {result.flags.length > 0 ? (
        <ul className="flags">
          {result.flags.map((flag, index) => (
            <li key={index} className="warn">
              ⚠ {flag.code} — {flag.detail} <span className="mono small">({flag.path})</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted small">No risk flags.</div>
      )}
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() =>
            void withBusy("Planning…", async () => {
              const steps = (await invoke("plan.skills", { items: [result.item], scope, home: env.home })) as PlanStep[];
              onPlanned(steps);
            })
          }
        >
          Plan install…
        </button>
      </div>
    </div>
  );
}

/* ── Add MCP ────────────────────────────────────────────────────────── */

function AddMcpTab({
  env,
  invoke,
  withBusy,
  onPlanned,
}: {
  env: EnvInfo;
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
  onPlanned: (steps: PlanStep[]) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envRows, setEnvRows] = useState<Array<{ key: string; placeholder: string }>>([]);
  const [scope, setScope] = useState<"user" | "project">("user");

  const item = {
    kind: "mcp",
    name,
    transport: "stdio",
    command,
    args: args.length === 0 ? undefined : args.split(" ").filter((arg) => arg !== ""),
    ...(envRows.length === 0
      ? {}
      : { env: Object.fromEntries(envRows.filter((row) => row.key !== "" && row.placeholder !== "").map((row) => [row.key, { placeholder: row.placeholder }])) }),
  };

  return (
    <section aria-label="Add MCP server">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void withBusy("Planning MCP install…", async () => {
            const steps = (await invoke("plan.mcp", { item, scope, home: env.home })) as PlanStep[];
            onPlanned(steps);
          });
        }}
      >
        <label className="row-gap">
          Server name (letters, digits, - and _)
          <input value={name} onChange={(event) => setName(event.target.value)} required pattern="[A-Za-z0-9][A-Za-z0-9_-]*" />
        </label>
        <label className="row-gap">
          Command
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" required />
        </label>
        <label className="row-gap">
          Arguments (space-separated)
          <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @team/mcp-server" />
        </label>
        <fieldset>
          <legend>Environment variables — placeholder NAMES only; real values go into the protected store (Secrets tab)</legend>
          {envRows.map((row, index) => (
            <div key={index} className="row">
              <input
                value={row.key}
                onChange={(event) =>
                  setEnvRows(envRows.map((candidate, i) => (i === index ? { ...candidate, key: event.target.value } : candidate)))
                }
                placeholder="ENV_VAR_NAME (what the server reads)"
              />
              <input
                value={row.placeholder}
                onChange={(event) =>
                  setEnvRows(envRows.map((candidate, i) => (i === index ? { ...candidate, placeholder: event.target.value } : candidate)))
                }
                placeholder="PLACEHOLDER (your local name for the value)"
              />
              <button type="button" onClick={() => setEnvRows(envRows.filter((_, i) => i !== index))}>
                remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setEnvRows([...envRows, { key: "", placeholder: "" }])}>
            Add env var
          </button>
        </fieldset>
        <fieldset>
          <legend>Scope</legend>
          <label className="row-gap">
            <input type="radio" name="mcp-scope" checked={scope === "user"} onChange={() => setScope("user")} /> user (this machine, all
            projects)
          </label>
          <label className="row-gap">
            <input type="radio" name="mcp-scope" checked={scope === "project"} onChange={() => setScope("project")} /> project (.mcp.json —
            committed; placeholders only, never real values)
          </label>
        </fieldset>
        <div className="row">
          <button type="submit" className="primary">
            Plan install…
          </button>
          {command !== "" && (
            <button
              type="button"
              onClick={() =>
                void withBusy("Running connection test…", async () => {
                  const argv = [command, ...args.split(" ").filter((arg) => arg !== "")];
                  const result = (await invoke("mcp.test", { argv, label: name === "" ? "unnamed server" : name })) as McpTestResult;
                  window.alert(
                    result.approved
                      ? `Connection test: exit ${String(result.exitCode)}\n\nstdout:\n${result.stdout || "(none)"}\n\nstderr:\n${result.stderr || "(none)"}`
                      : "Canceled — nothing ran.",
                  );
                })
              }
            >
              Test command…
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

/* ── Secrets ────────────────────────────────────────────────────────── */

function SecretsTab({
  invoke,
  withBusy,
}: {
  invoke: (op: string, payload: unknown) => Promise<unknown>;
  withBusy: (label: string, fn: () => Promise<void>) => Promise<void>;
}) {
  const [status, setStatus] = useState<{ encryptionAvailable: boolean } | undefined>(undefined);
  const [names, setNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setStatus((await invoke("secrets.status", {})) as { encryptionAvailable: boolean });
    setNames(((await invoke("secrets.names", {})) as { names: string[] }).names);
  }, [invoke]);

  useEffect(() => {
    withBusy("Loading secrets…", refresh).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  return (
    <section aria-label="Secrets">
      {status !== undefined && !status.encryptionAvailable && (
        <div className="card error" role="alert">
          OS-protected storage is unavailable. Values you enter are kept in memory for THIS RUN ONLY and never written to disk (fail
          closed).
        </div>
      )}
      {notice !== undefined && (
        <div className="card ok" role="status">
          {notice}{" "}
          <button type="button" className="link" onClick={() => setNotice(undefined)}>
            dismiss
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void withBusy("Saving secret…", async () => {
            const result = (await invoke("secrets.set", { name: newName, value: newValue })) as { persisted: boolean };
            setNotice(result.persisted ? `${newName} stored with OS-protected storage.` : `${newName} kept in memory for this run only (protected storage unavailable).`);
            setNewName("");
            setNewValue("");
            await refresh();
          });
        }}
      >
        <label className="row-gap">
          Placeholder name
          <input value={newName} onChange={(event) => setNewName(event.target.value)} required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="TEAM_GITHUB_TOKEN" />
        </label>
        <label className="row-gap">
          Value (stored encrypted; never shown again, never uploaded)
          <input type="password" value={newValue} onChange={(event) => setNewValue(event.target.value)} required />
        </label>
        <button type="submit" className="primary">
          Store value
        </button>
      </form>
      <h2>Stored placeholders</h2>
      {names.length === 0 ? (
        <Empty text="Nothing stored yet." />
      ) : (
        <ul className="entries">
          {names.map((name) => (
            <li key={name} className="card entry">
              <span className="mono">{name}</span>
              <button
                type="button"
                onClick={() =>
                  void withBusy("Deleting…", async () => {
                    await invoke("secrets.delete", { name });
                    await refresh();
                  })
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
