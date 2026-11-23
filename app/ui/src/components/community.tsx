/**
 * The Community and Saved tabs of the template list (plan phase 9,
 * increment E). The rows are the local mirror of the registry's change
 * feed — what the last sync applied — so the tabs work offline: the
 * list is whatever the app last saw, and a sync button moves it.
 */
import type { CommunityTemplate } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** The one thing a tab row can do with its template, plus save state. */
export interface CommunityRowActions {
  /** Open the template: its local copy when saved, a fresh one when not. */
  onOpen: (row: CommunityTemplate) => void;
  /** Save the template to the signed-in account. */
  onSave: (row: CommunityTemplate) => void;
  /** Take the template off the account's saved list. */
  onUnsave: (row: CommunityTemplate) => void;
  /** Whether saving is on: needs a signed-in account. */
  canSave: boolean;
}

/** A list of community templates, for the Community and Saved tabs. */
export function CommunityList({
  title,
  note,
  rows,
  emptyNote,
  actions,
}: {
  title: string;
  note: string;
  rows: CommunityTemplate[];
  /** Shown when the list is empty, in place of the rows. */
  emptyNote: string;
  actions: CommunityRowActions;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-body text-muted-foreground">{note}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-body text-muted-foreground">
          {emptyNote}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <Card key={`${row.owner}/${row.slug}`}>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {row.name}
                    <Badge
                      variant={row.track === "scene" ? "default" : "secondary"}
                    >
                      {row.track === "scene" ? "scene" : "document"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    by {row.owner}
                    {row.readme ? ` — ${row.readme}` : ""}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => actions.onOpen(row)}
                  >
                    Open
                  </Button>
                  {row.saved ? (
                    <Button
                      variant="outline"
                      disabled={!actions.canSave}
                      onClick={() => actions.onUnsave(row)}
                    >
                      Unsave
                    </Button>
                  ) : (
                    <Button
                      disabled={!actions.canSave}
                      onClick={() => actions.onSave(row)}
                    >
                      Save
                    </Button>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
