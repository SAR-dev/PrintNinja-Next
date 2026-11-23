import { useEffect, useState } from "react";
import {
  communityTemplates,
  loadRecentJobs,
  loadSettings,
  loadTemplates,
  publications,
  publishTemplate,
  registryLogin,
  registryLogout,
  registryRefresh,
  registryStatus,
  saveCommunityTemplate,
  type CommunityTemplate,
  type JobReport,
  printJob,
  rememberJob,
  type Publication,
  saveTemplate,
  type RegistryStatus,
  type StoredJob,
  type StoredTemplate,
  unpublishTemplate,
  unsaveCommunityTemplate,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommunityList } from "@/components/community";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { blankTemplate } from "@/scene/editor-model";
import { DeepLinkListener } from "@/deeplink";
import { DocumentEditorScreen } from "@/screens/document-editor-screen";
import { EditorScreen } from "@/screens/editor-screen";
import { PrintScreen } from "@/screens/print-screen";
import { SettingsScreen } from "@/screens/settings-screen";
import { RESULT_WORDS, toneClass } from "@/result-words";
import {
  blankDocument,
  mergeTemplates,
  starters,
  type AppTemplate,
  type RecentJob,
} from "@/templates";

/** How many jobs the recent list remembers (the store keeps the same). */
const RECENT_LIMIT = 10;

/** The list view's tabs. */
type Tab = "mine" | "community" | "saved";

/** The stored row for a template: the template as JSON text. */
function toStoredTemplate(t: AppTemplate): StoredTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    track: t.track,
    template: JSON.stringify(t.template),
    sample: t.sample,
  };
}

/** The stored row for a job: template, transport and result as JSON text. */
function toStoredJob(j: RecentJob): StoredJob {
  return {
    id: j.id,
    templateName: j.templateName,
    template: JSON.stringify(j.template),
    track: j.track,
    profile: j.profile,
    data: j.data,
    copies: j.copies,
    transport: JSON.stringify(j.transport),
    result: JSON.stringify(j.result),
    at: j.at,
  };
}

function fromStoredJob(row: StoredJob): RecentJob {
  return {
    id: row.id,
    templateName: row.templateName,
    template: JSON.parse(row.template) as RecentJob["template"],
    track: row.track as RecentJob["track"],
    profile: row.profile,
    data: row.data,
    copies: row.copies,
    transport: JSON.parse(row.transport) as RecentJob["transport"],
    result: JSON.parse(row.result) as RecentJob["result"],
    at: row.at,
  };
}

function jobTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${hm}` : `${d.toLocaleDateString()} ${hm}`;
}

/** Put the app in the given theme ("dark" or "light"). */
function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "";
}

/** What a deep link prefill on the print screen carries (plan phase 8). */
type PrintPrefill = { printer?: string; copies?: number };

type View =
  | { name: "list" }
  | { name: "print"; template: AppTemplate; prefill?: PrintPrefill }
  | { name: "edit"; template: AppTemplate }
  | { name: "document-edit"; template: AppTemplate }
  | { name: "settings" };

/** The registry's state in one line: online, who is signed in, and
 * how many operations are waiting for the connection. */
function RegistryChip({ status }: { status: RegistryStatus }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-caption">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          status.online ? "bg-success" : "bg-muted-foreground/40"
        }`}
      />
      {status.online ? "Registry online" : "Registry offline"}
      <span className="truncate text-muted-foreground">
        · {status.handle ?? "not signed in"}
        {status.pending > 0 ? ` · ${status.pending} waiting` : ""}
      </span>
    </span>
  );
}

function TemplatesScreen({
  templates,
  recent,
  reprintingId,
  publications,
  onPrint,
  onEdit,
  onNew,
  onReprint,
  onPublish,
  onUnpublish,
  storageError,
}: {
  templates: AppTemplate[];
  recent: RecentJob[];
  /** The job whose reprint is running, if any. */
  reprintingId: string | null;
  /** This device's publications, keyed by their local template. */
  publications: Publication[];
  onPrint: (t: AppTemplate) => void;
  onEdit: (t: AppTemplate) => void;
  onNew: () => void;
  onReprint: (job: RecentJob) => void;
  /** Publish a local template; the App opens the sign-in dialog when
   * the account is not signed in. */
  onPublish: (t: AppTemplate) => void;
  onUnpublish: (t: AppTemplate) => void;
  /** A local-storage failure, in plain words, if there is one. */
  storageError: string | null;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display font-semibold tracking-tight">
          PrintNinja
        </h1>
        <p className="text-body text-muted-foreground">
          Pick a template, enter the data, print.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {templates.map((t) => {
          const published = publications.some(
            (p) => p.localTemplateId === t.id,
          );
          return (
            <Card key={t.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {t.name}
                    <Badge
                      variant={t.track === "scene" ? "default" : "secondary"}
                    >
                      {t.track === "scene" ? "scene" : "document"}
                    </Badge>
                    {published && <Badge variant="secondary">published</Badge>}
                  </CardTitle>
                  <CardDescription>{t.description}</CardDescription>
                </div>
                <div className="flex gap-2">
                  {published ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUnpublish(t)}
                    >
                      Unpublish
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => onPublish(t)}>
                      Publish
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => onEdit(t)}>
                    Edit
                  </Button>
                  <Button onClick={() => onPrint(t)}>Print</Button>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Recent jobs</h2>
          <div className="flex flex-col gap-2">
            {recent.map((j) => {
              const entry = RESULT_WORDS[j.result.result] ?? {
                word: j.result.result,
                tone: "danger" as const,
              };
              const busy = reprintingId === j.id;
              const failed =
                j.result.result === "failed" ||
                j.result.result === "wrong_mode_suspected";
              return (
                <div
                  key={j.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium">
                      {j.templateName}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {jobTime(j.at)} · {j.copies} cop
                      {j.copies === 1 ? "y" : "ies"} · {j.profile}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`rounded-md px-2 py-1 text-caption font-medium ${toneClass(entry.tone)}`}
                    >
                      {entry.word}
                      {j.result.result === "partially_printed" &&
                      j.result.counts
                        ? ` — ${j.result.counts[0]} of ${j.result.counts[1]}`
                        : ""}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onReprint(j)}
                    >
                      {busy ? "Printing…" : failed ? "Retry" : "Reprint"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between gap-4">
        {storageError ? (
          <p className="text-caption text-danger">
            Local storage: {storageError}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            Templates and recent jobs are saved on this computer.
          </p>
        )}
        <Button variant="outline" onClick={onNew}>
          New template
        </Button>
      </div>
    </main>
  );
}

function App() {
  const [templates, setTemplates] = useState<AppTemplate[]>(starters);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "list" });
  const [newOpen, setNewOpen] = useState(false);
  /** A deep link that could not be honoured, in plain words. */
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // The community registry (plan phase 9): the tab, the mirror's rows,
  // this device's publications, and the sign-in and publish dialogs.
  const [tab, setTab] = useState<Tab>("mine");
  const [registry, setRegistry] = useState<RegistryStatus>({
    handle: null,
    online: false,
    pending: 0,
  });
  const [community, setCommunity] = useState<CommunityTemplate[]>([]);
  const [myPublications, setMyPublications] = useState<Publication[]>([]);
  const [registryBusy, setRegistryBusy] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [signinOpen, setSigninOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signinHandle, setSigninHandle] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signinCreate, setSigninCreate] = useState(false);
  const [publishing, setPublishing] = useState<AppTemplate | null>(null);
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishSlug, setPublishSlug] = useState("");
  const [publishReadme, setPublishReadme] = useState("");

  // The local store: what the user saved comes back on start.
  useEffect(() => {
    loadTemplates()
      .then((rows) => {
        if (rows.length > 0) setTemplates(mergeTemplates(starters, rows));
      })
      .catch((e) => setStorageError(String(e)));
    loadRecentJobs()
      .then((rows) => setRecent(rows.map(fromStoredJob)))
      .catch((e) => setStorageError(String(e)));
    // The appearance the settings screen saved; dark until it says so.
    loadSettings()
      .then((rows) => applyTheme(rows.theme ?? "dark"))
      .catch(() => applyTheme("dark"));
    // The registry's state at start: a probe, not a sync — the sync
    // waits for the button, so a cold start never blocks on a server.
    registryStatus()
      .then(setRegistry)
      .catch((e) => setRegistryError(String(e)));
    communityTemplates()
      .then(setCommunity)
      .catch((e) => setRegistryError(String(e)));
    publications()
      .then(setMyPublications)
      .catch((e) => setRegistryError(String(e)));
  }, []);

  const recordJob = (j: RecentJob) => {
    setRecent((rs) => [j, ...rs].slice(0, RECENT_LIMIT));
    void rememberJob(toStoredJob(j)).catch((e) => setStorageError(String(e)));
  };

  /** Print the same job again — its frozen template, data and transport. */
  const reprint = async (job: RecentJob) => {
    setReprintingId(job.id);
    let result: JobReport;
    try {
      result = await printJob(
        JSON.stringify(job.template),
        job.profile,
        job.data,
        job.copies,
        job.transport,
      );
    } catch (e) {
      result = { result: "failed", counts: null, reason: String(e) };
    }
    setRecent((rs) =>
      rs.map((j) => (j.id === job.id ? { ...j, result, at: Date.now() } : j)),
    );
    setReprintingId(null);
  };

  const upsert = (t: AppTemplate) => {
    setTemplates((ts) =>
      ts.some((x) => x.id === t.id)
        ? ts.map((x) => (x.id === t.id ? t : x))
        : [...ts, t],
    );
    saveTemplate(toStoredTemplate(t)).catch((e) => setStorageError(String(e)));
  };

  /** What a sync brings back: the status, the mirror, the
   * publications, and the local copies a save materialized. */
  const syncRegistry = async () => {
    setRegistryBusy(true);
    try {
      const status = await registryRefresh();
      setRegistry(status);
      setRegistryError(null);
      const [rows, pubs] = await Promise.all([
        communityTemplates(),
        publications(),
      ]);
      setCommunity(rows);
      setMyPublications(pubs);
      // A save made here (or on another device) lands as a local copy.
      const local = await loadTemplates();
      if (local.length > 0) setTemplates(mergeTemplates(starters, local));
    } catch (e) {
      setRegistryError(String(e));
    }
    setRegistryBusy(false);
  };

  const signOut = async () => {
    try {
      await registryLogout();
      setRegistry(await registryStatus());
      const [rows, pubs] = await Promise.all([
        communityTemplates(),
        publications(),
      ]);
      setCommunity(rows);
      setMyPublications(pubs);
      setRegistryError(null);
    } catch (e) {
      setRegistryError(String(e));
    }
  };

  const signIn = async () => {
    setSigningIn(true);
    try {
      await registryLogin(signinHandle.trim(), signinPassword, signinCreate);
      setRegistry(await registryStatus());
      setSigninOpen(false);
      setSigninPassword("");
      await syncRegistry();
    } catch (e) {
      setRegistryError(String(e));
    }
    setSigningIn(false);
  };

  /** Publish a local template: the dialog's words, the document from
   * the store. Signed out, the sign-in dialog comes first. */
  const openPublish = (t: AppTemplate) => {
    if (!registry.handle) {
      setSigninOpen(true);
      return;
    }
    setPublishName(t.name);
    setPublishSlug("");
    setPublishReadme(t.description);
    setPublishing(t);
  };

  const doPublish = async () => {
    if (!publishing) return;
    setPublishingBusy(true);
    try {
      await publishTemplate(
        publishing.id,
        publishName.trim(),
        publishSlug.trim(),
        publishReadme.trim(),
      );
      setPublishing(null);
      await syncRegistry();
    } catch (e) {
      setRegistryError(String(e));
    }
    setPublishingBusy(false);
  };

  const unpublish = async (t: AppTemplate) => {
    try {
      await unpublishTemplate(t.id);
      await syncRegistry();
    } catch (e) {
      setRegistryError(String(e));
    }
  };

  const saveCommunity = async (row: CommunityTemplate) => {
    try {
      await saveCommunityTemplate(row.owner, row.slug);
      await syncRegistry();
    } catch (e) {
      setRegistryError(String(e));
    }
  };

  const unsaveCommunity = async (row: CommunityTemplate) => {
    try {
      await unsaveCommunityTemplate(row.owner, row.slug);
      await syncRegistry();
    } catch (e) {
      setRegistryError(String(e));
    }
  };

  /** Open a community template: its local copy when it is saved, a
   * fresh template when it is not — saving it stores it locally. */
  const openCommunity = (row: CommunityTemplate) => {
    let t: AppTemplate;
    try {
      const copy = templates.find(
        (x) => x.id === `saved-${row.owner}-${row.slug}`,
      );
      t =
        copy ??
        ({
          id: `user-${Date.now().toString(36)}`,
          name: row.name,
          description:
            row.readme || `Saved from the community, by ${row.owner}`,
          track: row.track === "document" ? "document" : "scene",
          template: JSON.parse(row.template) as AppTemplate["template"],
          sample: row.sample,
        } satisfies AppTemplate);
    } catch (e) {
      setRegistryError(String(e));
      return;
    }
    setView(
      t.track === "scene"
        ? { name: "edit", template: t }
        : { name: "document-edit", template: t },
    );
  };

  const newScene = () => {
    const t: AppTemplate = {
      id: `user-${Date.now().toString(36)}`,
      name: "New label",
      description: "A 40 × 50 mm label.",
      track: "scene",
      template: blankTemplate(),
      sample: '[{"name":"Item 1"}]',
    };
    setNewOpen(false);
    setView({ name: "edit", template: t });
  };

  const newDocument = () => {
    setNewOpen(false);
    setView({ name: "document-edit", template: blankDocument() });
  };

  const editTemplate = (t: AppTemplate) =>
    setView(
      t.track === "scene"
        ? { name: "edit", template: t }
        : { name: "document-edit", template: t },
    );

  return (
    <div className="min-h-dvh-safe bg-background">
      {/* A link can arrive on any view, so the error sits above them all. */}
      {deepLinkError && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-4 border-b border-danger/40 bg-danger-soft px-6 py-3">
          <p className="text-body text-danger">{deepLinkError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeepLinkError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}
      <DeepLinkListener
        onPrint={({ template, printer, copies }) =>
          setView({
            name: "print",
            template,
            prefill: {
              printer: printer ?? undefined,
              copies: copies ?? undefined,
            },
          })
        }
        onError={setDeepLinkError}
      />
      {view.name === "print" ? (
        <PrintScreen
          starter={view.template}
          prefill={view.prefill}
          onBack={() => setView({ name: "list" })}
          onJob={recordJob}
        />
      ) : view.name === "edit" ? (
        <EditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(t) => {
            upsert(t);
            setView({ name: "list" });
          }}
        />
      ) : view.name === "settings" ? (
        <SettingsScreen onBack={() => setView({ name: "list" })} />
      ) : view.name === "document-edit" ? (
        <DocumentEditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(t) => {
            upsert(t);
            setView({ name: "list" });
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <RegistryChip status={registry} />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={registryBusy}
                onClick={() => void syncRegistry()}
              >
                {registryBusy ? "Syncing…" : "Sync"}
              </Button>
              {registry.handle ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void signOut()}
                >
                  Sign out
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSigninOpen(true)}
                >
                  Sign in
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView({ name: "settings" })}
              >
                Settings
              </Button>
            </div>
          </div>
          {registryError && (
            <p className="mx-8 -mb-2 rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
              {registryError}
            </p>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="mx-auto w-full max-w-3xl px-8"
          >
            <TabsList>
              <TabsTrigger value="mine">Mine</TabsTrigger>
              <TabsTrigger value="community">Community</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
            </TabsList>
            <TabsContent value="mine">
              <TemplatesScreen
                templates={templates}
                recent={recent}
                reprintingId={reprintingId}
                publications={myPublications}
                onPrint={(t) => setView({ name: "print", template: t })}
                onEdit={editTemplate}
                onNew={() => setNewOpen(true)}
                onReprint={(j) => void reprint(j)}
                onPublish={openPublish}
                onUnpublish={(t) => void unpublish(t)}
                storageError={storageError}
              />
            </TabsContent>
            <TabsContent value="community">
              <CommunityList
                title="Community"
                note="Published by everyone on the registry, as the last sync saw them."
                rows={community}
                emptyNote="Nothing published yet, or the last sync has not run. Press Sync."
                actions={{
                  onOpen: openCommunity,
                  onSave: (row) => void saveCommunity(row),
                  onUnsave: (row) => void unsaveCommunity(row),
                  canSave: !!registry.handle,
                }}
              />
            </TabsContent>
            <TabsContent value="saved">
              <CommunityList
                title="Saved"
                note="The community templates your account has saved — each one also lives on this computer."
                rows={community.filter((row) => row.saved)}
                emptyNote="Nothing saved yet. Save a template from the Community tab."
                actions={{
                  onOpen: openCommunity,
                  onSave: (row) => void saveCommunity(row),
                  onUnsave: (row) => void unsaveCommunity(row),
                  canSave: !!registry.handle,
                }}
              />
            </TabsContent>
          </Tabs>
          <Dialog open={signinOpen} onOpenChange={setSigninOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Sign in to the registry</DialogTitle>
                <DialogDescription>
                  A handle and a password, no email. The account is for
                  publishing and saving community templates.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-handle">Handle</Label>
                  <Input
                    id="signin-handle"
                    value={signinHandle}
                    onChange={(e) => setSigninHandle(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <PasswordInput
                    id="signin-password"
                    value={signinPassword}
                    onChange={(e) => setSigninPassword(e.target.value)}
                    autoComplete={
                      signinCreate ? "new-password" : "current-password"
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-body">
                    New here? Create the account
                  </span>
                  <Switch
                    checked={signinCreate}
                    onCheckedChange={setSigninCreate}
                    aria-label="New here? Create the account"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={signingIn || signinHandle.trim() === ""}
                  onClick={() => void signIn()}
                >
                  {signingIn
                    ? "Signing in…"
                    : signinCreate
                      ? "Create and sign in"
                      : "Sign in"}
                </Button>
                <Button variant="ghost" onClick={() => setSigninOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={publishing !== null}
            onOpenChange={(open) => {
              if (!open) setPublishing(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Publish {publishing?.name ?? ""} to the community
                </DialogTitle>
                <DialogDescription>
                  The template goes up as {registry.handle}'s. Leave the slug
                  empty and it is drafted from the name.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-name">Name</Label>
                  <Input
                    id="publish-name"
                    value={publishName}
                    onChange={(e) => setPublishName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-slug">Slug</Label>
                  <Input
                    id="publish-slug"
                    value={publishSlug}
                    onChange={(e) => setPublishSlug(e.target.value)}
                    placeholder="drafted from the name when empty"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-readme">Readme</Label>
                  <Textarea
                    id="publish-readme"
                    value={publishReadme}
                    onChange={(e) => setPublishReadme(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={publishingBusy || publishName.trim() === ""}
                  onClick={() => void doPublish()}
                >
                  {publishingBusy ? "Publishing…" : "Publish"}
                </Button>
                <Button variant="ghost" onClick={() => setPublishing(null)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New template</DialogTitle>
                <DialogDescription>
                  Which track does it use? The track is fixed by the template's
                  format.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Button onClick={newScene}>
                  Scene — labels, rolls and pages
                </Button>
                <Button variant="secondary" onClick={newDocument}>
                  Document — HTML/CSS
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

export default App;
