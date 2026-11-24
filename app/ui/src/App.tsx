import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { JobResultBadge, StatusBadge } from "@/components/status-badge";
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
import { UpdateBadge } from "@/components/update-badge";
import { blankTemplate } from "@/scene/editor-model";
import { DeepLinkListener } from "@/deeplink";
import i18n from "@/lib/i18n";
import { DocumentEditorScreen } from "@/screens/document-editor-screen";
import { EditorScreen } from "@/screens/editor-screen";
import { PrintScreen } from "@/screens/print-screen";
import { SettingsScreen } from "@/screens/settings-screen";
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
  return sameDay
    ? i18n.t("recent.today", { time: hm })
    : i18n.t("recent.day", { date: d.toLocaleDateString(), time: hm });
}

/** Put the app in the given theme ("dark" or "light"). */
function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "";
}

/** What a deep link prefill on the print screen carries (plan phase 8). */
type PrintPrefill = {
  printer?: string;
  copies?: number;
  dataUrl?: string;
};

type View =
  | { name: "list" }
  | { name: "print"; template: AppTemplate; prefill?: PrintPrefill }
  | { name: "edit"; template: AppTemplate }
  | { name: "document-edit"; template: AppTemplate }
  | { name: "settings" };

/** The registry's state in the top bar: its reach, who is signed
 * in, and how many operations are waiting for the connection. */
function RegistryChip({ status }: { status: RegistryStatus }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <StatusBadge status={status.online ? "online" : "offline"} compact />
      <span className="hidden min-w-0 truncate text-caption text-muted-foreground lg:inline">
        {status.handle ?? t("registry.not_signed_in")}
        {status.pending > 0
          ? ` · ${t("registry.waiting", { count: status.pending })}`
          : ""}
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
  onReprint: (job: RecentJob) => void;
  /** Publish a local template; the App opens the sign-in dialog when
   * the account is not signed in. */
  onPublish: (t: AppTemplate) => void;
  onUnpublish: (t: AppTemplate) => void;
  /** A local-storage failure, in plain words, if there is one. */
  storageError: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {templates.map((tpl) => {
          const published = publications.some(
            (p) => p.localTemplateId === tpl.id,
          );
          return (
            <Card key={tpl.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {tpl.name}
                    <Badge
                      variant={tpl.track === "scene" ? "default" : "secondary"}
                    >
                      {tpl.track === "scene"
                        ? t("app.track_scene")
                        : t("app.track_document")}
                    </Badge>
                    {published && (
                      <Badge variant="secondary">{t("app.published")}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{tpl.description}</CardDescription>
                </div>
                <div className="flex gap-2">
                  {published ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUnpublish(tpl)}
                    >
                      {t("app.unpublish")}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => onPublish(tpl)}>
                      {t("app.publish")}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => onEdit(tpl)}>
                    {t("app.edit")}
                  </Button>
                  <Button onClick={() => onPrint(tpl)}>{t("app.print")}</Button>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">{t("recent.title")}</h2>
          <div className="flex flex-col gap-2">
            {recent.map((j) => {
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
                      {jobTime(j.at)} ·{" "}
                      {t("recent.copies", { count: j.copies })} · {j.profile}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <JobResultBadge result={j.result.result} />
                    {j.result.result === "partially_printed" &&
                      j.result.counts && (
                        <span className="text-caption text-muted-foreground">
                          {t("recent.partial", {
                            printed: j.result.counts[0],
                            total: j.result.counts[1],
                          })}
                        </span>
                      )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onReprint(j)}
                    >
                      {busy
                        ? t("recent.printing")
                        : failed
                          ? t("recent.retry")
                          : t("recent.reprint")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div>
        {storageError ? (
          <p className="text-caption text-danger">
            {t("app.local_storage_error", { error: storageError })}
          </p>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("app.local_storage_note")}
          </p>
        )}
      </div>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
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

  const upsert = (tpl: AppTemplate) => {
    setTemplates((ts) =>
      ts.some((x) => x.id === tpl.id)
        ? ts.map((x) => (x.id === tpl.id ? tpl : x))
        : [...ts, tpl],
    );
    saveTemplate(toStoredTemplate(tpl)).catch((e) =>
      setStorageError(String(e)),
    );
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
  const openPublish = (tpl: AppTemplate) => {
    if (!registry.handle) {
      setSigninOpen(true);
      return;
    }
    setPublishName(tpl.name);
    setPublishSlug("");
    setPublishReadme(tpl.description);
    setPublishing(tpl);
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

  const unpublish = async (tpl: AppTemplate) => {
    try {
      await unpublishTemplate(tpl.id);
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
    let tpl: AppTemplate;
    try {
      const copy = templates.find(
        (x) => x.id === `saved-${row.owner}-${row.slug}`,
      );
      tpl =
        copy ??
        ({
          id: `user-${Date.now().toString(36)}`,
          name: row.name,
          description:
            row.readme ||
            t("registry.saved_from_community", { owner: row.owner }),
          track: row.track === "document" ? "document" : "scene",
          template: JSON.parse(row.template) as AppTemplate["template"],
          sample: row.sample,
        } satisfies AppTemplate);
    } catch (e) {
      setRegistryError(String(e));
      return;
    }
    setView(
      tpl.track === "scene"
        ? { name: "edit", template: tpl }
        : { name: "document-edit", template: tpl },
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

  const editTemplate = (tpl: AppTemplate) =>
    setView(
      tpl.track === "scene"
        ? { name: "edit", template: tpl }
        : { name: "document-edit", template: tpl },
    );

  return (
    <Layout
      active={view.name === "settings" ? "settings" : "templates"}
      onNavigate={(key) =>
        setView(key === "settings" ? { name: "settings" } : { name: "list" })
      }
      topbar={
        <>
          <RegistryChip status={registry} />
          <UpdateBadge />
          <Button
            variant="outline"
            size="sm"
            disabled={registryBusy}
            onClick={() => void syncRegistry()}
          >
            {registryBusy ? t("registry.syncing") : t("registry.sync")}
          </Button>
          {registry.handle ? (
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              {t("registry.sign_out")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSigninOpen(true)}
            >
              {t("registry.sign_in")}
            </Button>
          )}
        </>
      }
    >
      {/* A link can arrive on any view, so the error sits above them all. */}
      {deepLinkError && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-danger bg-danger-soft px-4 py-3">
          <p className="text-body-sm text-danger">{deepLinkError}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeepLinkError(null)}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      )}
      <DeepLinkListener
        onPrint={({ template, printer, copies, dataUrl }) =>
          setView({
            name: "print",
            template,
            prefill: {
              printer: printer ?? undefined,
              copies: copies ?? undefined,
              dataUrl: dataUrl ?? undefined,
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
          onSave={(tpl) => {
            upsert(tpl);
            setView({ name: "list" });
          }}
        />
      ) : view.name === "settings" ? (
        <SettingsScreen onBack={() => setView({ name: "list" })} />
      ) : view.name === "document-edit" ? (
        <DocumentEditorScreen
          initial={view.template}
          onBack={() => setView({ name: "list" })}
          onSave={(tpl) => {
            upsert(tpl);
            setView({ name: "list" });
          }}
        />
      ) : (
        <>
          {registryError && (
            <div className="mx-auto w-full max-w-3xl">
              <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
                {registryError}
              </p>
            </div>
          )}
          <PageHeader title={t("app.title")} description={t("app.tagline")}>
            <Button onClick={() => setNewOpen(true)}>
              {t("app.new_template")}
            </Button>
          </PageHeader>
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="mx-auto flex w-full max-w-3xl flex-col gap-4"
          >
            <TabsList>
              <TabsTrigger value="mine">{t("tabs.mine")}</TabsTrigger>
              <TabsTrigger value="community">{t("tabs.community")}</TabsTrigger>
              <TabsTrigger value="saved">{t("tabs.saved")}</TabsTrigger>
            </TabsList>
            <TabsContent value="mine">
              <TemplatesScreen
                templates={templates}
                recent={recent}
                reprintingId={reprintingId}
                publications={myPublications}
                onPrint={(tpl) => setView({ name: "print", template: tpl })}
                onEdit={editTemplate}
                onReprint={(j) => void reprint(j)}
                onPublish={openPublish}
                onUnpublish={(tpl) => void unpublish(tpl)}
                storageError={storageError}
              />
            </TabsContent>
            <TabsContent value="community">
              <CommunityList
                title={t("tabs.community")}
                note={t("community.note")}
                rows={community}
                emptyNote={t("community.empty_note")}
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
                title={t("tabs.saved")}
                note={t("community.saved_note")}
                rows={community.filter((row) => row.saved)}
                emptyNote={t("community.saved_empty_note")}
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
                <DialogTitle>{t("registry.sign_in_title")}</DialogTitle>
                <DialogDescription>
                  {t("registry.sign_in_description")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-handle">{t("registry.handle")}</Label>
                  <Input
                    id="signin-handle"
                    value={signinHandle}
                    onChange={(e) => setSigninHandle(e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signin-password">
                    {t("registry.password")}
                  </Label>
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
                    {t("registry.create_account")}
                  </span>
                  <Switch
                    checked={signinCreate}
                    onCheckedChange={setSigninCreate}
                    aria-label={t("registry.create_account")}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={signingIn || signinHandle.trim() === ""}
                  onClick={() => void signIn()}
                >
                  {signingIn
                    ? t("registry.signing_in")
                    : signinCreate
                      ? t("registry.create_and_sign_in")
                      : t("registry.sign_in")}
                </Button>
                <Button variant="ghost" onClick={() => setSigninOpen(false)}>
                  {t("common.cancel")}
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
                  {t("registry.publish_title", {
                    name: publishing?.name ?? "",
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("registry.publish_description", {
                    handle: registry.handle ?? "",
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-name">{t("common.name")}</Label>
                  <Input
                    id="publish-name"
                    value={publishName}
                    onChange={(e) => setPublishName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-slug">{t("registry.slug")}</Label>
                  <Input
                    id="publish-slug"
                    value={publishSlug}
                    onChange={(e) => setPublishSlug(e.target.value)}
                    placeholder={t("registry.slug_placeholder")}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="publish-readme">{t("registry.readme")}</Label>
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
                  {publishingBusy ? t("registry.publishing") : t("app.publish")}
                </Button>
                <Button variant="ghost" onClick={() => setPublishing(null)}>
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("app.new_template")}</DialogTitle>
                <DialogDescription>
                  {t("app.new_template_description")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Button onClick={newScene}>{t("app.new_scene")}</Button>
                <Button variant="secondary" onClick={newDocument}>
                  {t("app.new_document")}
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setNewOpen(false)}>
                  {t("common.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </Layout>
  );
}

export default App;
