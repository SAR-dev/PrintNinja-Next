import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  communityTemplates,
  deleteTemplate,
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
  saveSetting,
  saveTemplate,
  type RegistryStatus,
  type StoredJob,
  type StoredTemplate,
  unpublishTemplate,
  unsaveCommunityTemplate,
} from "@/api";
import { AccountMenu } from "@/components/account-menu";
import { Layout } from "@/components/layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { blankTemplate } from "@/scene/editor-model";
import { DeepLinkListener } from "@/deeplink";
import type { NavKey } from "@/lib/nav";
import { DocumentEditorScreen } from "@/screens/document-editor-screen";
import { EditorScreen } from "@/screens/editor-screen";
import { CommunityScreen } from "@/screens/community-screen";
import { JobsScreen } from "@/screens/jobs-screen";
import { PrintScreen } from "@/screens/print-screen";
import { PrintersScreen } from "@/screens/printers-screen";
import { SettingsScreen } from "@/screens/settings-screen";
import { TemplatesScreen } from "@/screens/templates-screen";
import {
  blankDocument,
  mergeTemplates,
  starters,
  type AppTemplate,
  type RecentJob,
} from "@/templates";

/** How many jobs the recent list remembers (the store keeps the same). */
const RECENT_LIMIT = 10;

/** The setting that remembers the shipped starters the user deleted,
 * as an id list in JSON. A deleted starter would otherwise come back
 * on the next start, unedited, from the merged-in base list. */
const DELETED_STARTERS_KEY = "deletedTemplates";

/** The deleted starter ids out of a settings map, or none. */
function deletedIds(s: Record<string, string>): string[] {
  try {
    const v: unknown = JSON.parse(s[DELETED_STARTERS_KEY] ?? "[]");
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

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

/** The destinations are the nav items; the contextual views (print,
 * edit) carry their parent's key so it stays highlighted. */
type View =
  | { name: NavKey }
  | { name: "print"; template: AppTemplate; prefill?: PrintPrefill }
  | { name: "edit"; template: AppTemplate; from?: NavKey }
  | { name: "document-edit"; template: AppTemplate; from?: NavKey };

function App() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<AppTemplate[]>(starters);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "templates" });
  const [newOpen, setNewOpen] = useState(false);
  /** A deep link that could not be honoured, in plain words. */
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);

  // The community registry (plan phase 9): the destination's rows,
  // this device's publications, and the sign-in and publish dialogs.
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

  // The local store: what the user saved comes back on start; a
  // shipped starter the user deleted stays deleted (the tombstone).
  useEffect(() => {
    Promise.all([loadTemplates(), loadSettings()])
      .then(([rows, s]) => {
        const base = starters.filter((t) => !deletedIds(s).includes(t.id));
        setTemplates(rows.length > 0 ? mergeTemplates(base, rows) : base);
        // The appearance the settings screen saved; dark until it says so.
        applyTheme(s.theme ?? "dark");
      })
      .catch((e) => setStorageError(String(e)));
    loadRecentJobs()
      .then((rows) => setRecent(rows.map(fromStoredJob)))
      .catch((e) => setStorageError(String(e)));
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
      // A save made here (or on another device) lands as a local
      // copy; deleted starters stay out, as at the start.
      const [local, s] = await Promise.all([loadTemplates(), loadSettings()]);
      const base = starters.filter((t) => !deletedIds(s).includes(t.id));
      if (local.length > 0) setTemplates(mergeTemplates(base, local));
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

  /** Delete a local template. A shipped starter is also tombstoned,
   * so the next start does not merge it back in. */
  const deleteTpl = async (tpl: AppTemplate) => {
    try {
      await deleteTemplate(tpl.id);
      if (starters.some((s) => s.id === tpl.id)) {
        const s = await loadSettings();
        const hidden = deletedIds(s);
        if (!hidden.includes(tpl.id)) hidden.push(tpl.id);
        await saveSetting(DELETED_STARTERS_KEY, JSON.stringify(hidden));
      }
      setTemplates((ts) => ts.filter((x) => x.id !== tpl.id));
    } catch (e) {
      setStorageError(String(e));
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
        ? { name: "edit", template: tpl, from: "community" }
        : { name: "document-edit", template: tpl, from: "community" },
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

  const contextual =
    view.name === "print" ||
    view.name === "edit" ||
    view.name === "document-edit";
  const active: NavKey =
    view.name === "edit" || view.name === "document-edit"
      ? (view.from ?? "templates")
      : view.name === "print"
        ? "templates"
        : view.name;

  return (
    <Layout
      active={active}
      contextual={contextual}
      counts={{
        jobs: recent.length,
        community: community.filter((row) => row.saved).length,
      }}
      onNavigate={(key) => setView({ name: key } as View)}
      topbar={
        <AccountMenu
          status={registry}
          busy={registryBusy}
          onSync={() => void syncRegistry()}
          onSignIn={() => setSigninOpen(true)}
          onSignOut={() => void signOut()}
        />
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
      {registryError && (
        <div className="mx-auto w-full max-w-3xl">
          <p className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-body-sm text-danger">
            {registryError}
          </p>
        </div>
      )}
      {view.name === "print" ? (
        <PrintScreen
          starter={view.template}
          prefill={view.prefill}
          onBack={() => setView({ name: "templates" })}
          onJob={recordJob}
        />
      ) : view.name === "edit" ? (
        <EditorScreen
          initial={view.template}
          onBack={() => setView({ name: view.from ?? "templates" })}
          onSave={(tpl) => {
            upsert(tpl);
            setView({ name: view.from ?? "templates" });
          }}
        />
      ) : view.name === "document-edit" ? (
        <DocumentEditorScreen
          initial={view.template}
          onBack={() => setView({ name: view.from ?? "templates" })}
          onSave={(tpl) => {
            upsert(tpl);
            setView({ name: view.from ?? "templates" });
          }}
        />
      ) : view.name === "jobs" ? (
        <JobsScreen
          recent={recent}
          reprintingId={reprintingId}
          onReprint={(j) => void reprint(j)}
        />
      ) : view.name === "printers" ? (
        <PrintersScreen />
      ) : view.name === "community" ? (
        <CommunityScreen
          rows={community}
          actions={{
            onOpen: openCommunity,
            onSave: (row) => void saveCommunity(row),
            onUnsave: (row) => void unsaveCommunity(row),
            canSave: !!registry.handle,
          }}
        />
      ) : view.name === "settings" ? (
        <SettingsScreen />
      ) : (
        <TemplatesScreen
          templates={templates}
          publications={myPublications}
          storageError={storageError}
          onNew={() => setNewOpen(true)}
          onPrint={(tpl) => setView({ name: "print", template: tpl })}
          onEdit={editTemplate}
          onPublish={openPublish}
          onUnpublish={(tpl) => void unpublish(tpl)}
          onDelete={(tpl) => void deleteTpl(tpl)}
        />
      )}
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
              <Label htmlFor="signin-password">{t("registry.password")}</Label>
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
              <span className="text-body">{t("registry.create_account")}</span>
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
    </Layout>
  );
}

export default App;
