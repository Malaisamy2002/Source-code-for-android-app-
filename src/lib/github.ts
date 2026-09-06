import type { BackupFile } from "./backup";
import { isDesktop } from "./desktop";

export type GithubConfig = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
};

export const DEFAULT_GITHUB_CONFIG: GithubConfig = {
  owner: "",
  repo: "",
  branch: "main",
  path: "backups/turf-ledger.db",
  token: "",
};

// Non-secret fields only — safe in localStorage on both builds.
const META_KEY = "ks:github-backup";
// Same key used as a fallback token store in the browser/PWA build, where
// there is no OS credential store to move it into (documented risk, same
// as before this port — see windows-app-build-prompt.md §0.4). On desktop
// this key is never written to; the token lives in the OS credential store
// instead (Windows Credential Manager, via the `keyring` Rust crate, exposed
// through the `keyring_get_token` / `keyring_set_token` / `keyring_delete_token`
// Tauri commands registered in src-tauri/src/lib.rs).
const WEB_TOKEN_KEY = "ks:github-backup-token";
const KEYRING_SERVICE = "turf-snack-ledger";
const KEYRING_ACCOUNT = "github-backup-token";

type Meta = Omit<GithubConfig, "token">;

function readMeta(): Meta {
  if (typeof window === "undefined") {
    const { token: _token, ...rest } = DEFAULT_GITHUB_CONFIG;
    return rest;
  }
  try {
    const raw = window.localStorage.getItem(META_KEY);
    const { token: _token, ...rest } = DEFAULT_GITHUB_CONFIG;
    return raw ? { ...rest, ...(JSON.parse(raw) as Partial<Meta>) } : rest;
  } catch {
    const { token: _token, ...rest } = DEFAULT_GITHUB_CONFIG;
    return rest;
  }
}

function writeMeta(meta: Meta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

async function readToken(): Promise<string> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return (
        (await invoke<string | null>("keyring_get_token", {
          service: KEYRING_SERVICE,
          account: KEYRING_ACCOUNT,
        })) ?? ""
      );
    } catch {
      return ""; // nothing stored yet, or the OS credential store refused access
    }
  }
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(WEB_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

async function writeToken(token: string): Promise<void> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    if (token) {
      await invoke("keyring_set_token", {
        service: KEYRING_SERVICE,
        account: KEYRING_ACCOUNT,
        token,
      });
    } else {
      await invoke("keyring_delete_token", {
        service: KEYRING_SERVICE,
        account: KEYRING_ACCOUNT,
      }).catch(() => undefined); // fine if there was nothing to delete
    }
    return;
  }
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(WEB_TOKEN_KEY, token);
  else window.localStorage.removeItem(WEB_TOKEN_KEY);
}

/**
 * Reads the saved GitHub backup config. Async because the token half comes
 * from the OS credential store on desktop (`readToken` above) — every call
 * site was already inside an async handler, so this only adds `await`s, per
 * windows-app-build-prompt.md §3a's "keep signatures the same" guidance.
 */
export async function readGithubConfig(): Promise<GithubConfig> {
  const [meta, token] = await Promise.all([readMeta(), readToken()]);
  return { ...meta, token };
}

export async function writeGithubConfig(cfg: GithubConfig): Promise<void> {
  const { token, ...meta } = cfg;
  writeMeta(meta);
  await writeToken(token);
}

function assertConfig(cfg: GithubConfig) {
  if (!cfg.owner || !cfg.repo || !cfg.path || !cfg.token)
    throw new Error("Fill owner, repo, file path and access token first");
}

function api(cfg: GithubConfig) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path.replace(/^\/+/, "")}`;
}

function headers(cfg: GithubConfig) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const fromBase64 = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function currentSha(cfg: GithubConfig) {
  const res = await fetch(`${api(cfg)}?ref=${encodeURIComponent(cfg.branch || "main")}`, {
    headers: headers(cfg),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { sha: string };
  return json.sha;
}

/**
 * Creates a new file at an explicit repo path (used for per-year archives).
 * Refuses to overwrite an existing file so an archive can never clobber another.
 */
export async function githubPushFileAt(
  cfg: GithubConfig,
  path: string,
  text: string,
  message: string,
) {
  assertConfig(cfg);
  const target = { ...cfg, path };
  const existing = await currentSha(target);
  if (existing) throw new Error(`GitHub already has a file at ${path} — rename or remove it first`);
  const res = await fetch(api(target), {
    method: "PUT",
    headers: headers(cfg),
    body: JSON.stringify({
      message,
      content: toBase64(text),
      branch: cfg.branch || "main",
    }),
  });
  if (!res.ok) throw new Error(`GitHub push failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { commit?: { sha?: string } };
  return json.commit?.sha?.slice(0, 7) ?? "ok";
}

/** Commits the backup snapshot to the configured repo path. */
export async function githubPush(cfg: GithubConfig, backup: BackupFile) {
  assertConfig(cfg);
  const sha = await currentSha(cfg);
  const res = await fetch(api(cfg), {
    method: "PUT",
    headers: headers(cfg),
    body: JSON.stringify({
      message: `Ledger backup ${new Date().toISOString()}`,
      content: toBase64(JSON.stringify(backup, null, 2)),
      branch: cfg.branch || "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub push failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { commit?: { sha?: string } };
  return json.commit?.sha?.slice(0, 7) ?? "ok";
}

/** Fetches the backup file stored in the repo. */
export async function githubPull(cfg: GithubConfig): Promise<string> {
  assertConfig(cfg);
  const res = await fetch(`${api(cfg)}?ref=${encodeURIComponent(cfg.branch || "main")}`, {
    headers: headers(cfg),
  });
  if (res.status === 404) throw new Error("No backup file found at that path");
  if (!res.ok) throw new Error(`GitHub pull failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content) throw new Error("Empty file returned by GitHub");
  return fromBase64(json.content);
}

/** True when every field needed for push/pull is filled in. */
export function isGithubConfigured(cfg: GithubConfig) {
  return Boolean(cfg.owner && cfg.repo && cfg.path && cfg.token);
}
