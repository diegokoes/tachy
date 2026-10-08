import { azureDevopsToken, badInput, rememberSecret } from "@tachy/core/infra";
import { sourceFetch } from "@tachy/core/sources";

/** The released Azure DevOps REST version. Everything in 7.2 is still preview. */
const API_VERSION = "7.1";
/**
 * At $top=200 this is 20k comments on one work item: past any real ticket, and
 * the point where a continuation token that never clears is a bug.
 */
const MAX_PAGES = 100;
const WORK_ITEM_BATCH_SIZE = 200;

/** No released version: the 7.1 reference itself documents 7.1-preview.4. */
const API_COMMENTS = "7.1-preview.4";
/** No released version: connectionData is not in the public REST reference. */
const API_CONNECTION_DATA = "7.1-preview.1";
/** Project properties have no released version either. */
const API_PROJECT_PROPERTIES = "7.1-preview.1";

/**
 * Every request carries the version; only the preview endpoints name their own.
 * Concatenated rather than built through URL/searchParams, which would
 * re-encode the `$` operators and the pre-encoded wiki page paths.
 */
const withVersion = (path: string) =>
  path.includes("api-version=")
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;

export interface AdoCfg {
  baseUrl: string;
  slug: string;
  config: Record<string, unknown>;
  token?: string;
}

export interface AdoWorkItemSummary {
  id: number;
  title?: string;
  state?: string;
  type?: string;
  url?: string;
}

export interface JsonPatchOp {
  op: "add" | "replace" | "remove" | "test";
  path: string;
  value?: unknown;
}

/** An identity as a field or a comment carries it, e.g. System.CreatedBy. */
export interface AdoIdentity {
  displayName?: string;
  uniqueName?: string;
}

/** A work item's fields by reference name. Only the ones read here are named. */
export type AdoFields = {
  "System.Title"?: string;
  "System.State"?: string;
  "System.TeamProject"?: string;
  "System.AreaPath"?: string;
  "System.WorkItemType"?: string;
  "System.CreatedBy"?: AdoIdentity;
  "System.CreatedDate"?: string;
  "System.ChangedDate"?: string;
  "System.Description"?: string;
  "Microsoft.VSTS.TCM.ReproSteps"?: string;
} & Record<string, unknown>;

export interface AdoRelation {
  rel?: string;
  url?: string;
}

export interface AdoWorkItem {
  id: number;
  rev?: number;
  fields?: AdoFields;
  relations?: AdoRelation[];
  _links?: { html?: { href?: string } };
}

export interface AdoComment {
  id: number;
  text?: string;
  createdBy?: AdoIdentity;
  createdDate?: string;
}

export interface AdoPullRequest {
  pullRequestId: number;
  title?: string;
  status?: string;
  repository?: { name?: string; project?: { name?: string } };
}

export interface AdoCommit {
  commitId: string;
  comment?: string;
  author?: { name?: string };
  remoteUrl?: string;
}

export interface AdoConnectionData {
  authenticatedUser?: {
    providerDisplayName?: string;
    properties?: { Account?: { $value?: string } };
  };
}

export interface AdoWorkItemType {
  name: string;
  referenceName?: string;
  description?: string;
  /** Hex without the '#', e.g. "CC293D". */
  color?: string;
  /** `id` names one of ADO's stock glyphs; `url` needs the PAT to load. */
  icon?: { id?: string; url?: string };
  isDisabled?: boolean;
}

export interface AdoTypeCategory {
  name?: string;
  referenceName?: string;
  workItemTypes?: { name: string }[];
}

export interface AdoTeamRef {
  id: string;
  name: string;
}

export interface AdoIterationRef {
  id?: string;
  name?: string;
  path?: string;
}

export interface AdoTeamSettings {
  /** The iteration a new work item gets when the team is the creator's. */
  defaultIteration?: AdoIterationRef;
  /** e.g. "@currentIteration": when set it wins over `defaultIteration`. */
  defaultIterationMacro?: string;
  backlogIteration?: AdoIterationRef;
}

export interface AdoTeamIteration {
  id: string;
  name: string;
  path?: string;
  attributes?: {
    startDate?: string | null;
    finishDate?: string | null;
    timeFrame?: "past" | "current" | "future";
  };
}

export interface AdoTeamFieldValues {
  /** The team's default area path. */
  defaultValue?: string;
  field?: { referenceName?: string };
  values?: { value: string; includeChildren?: boolean }[];
}

export interface AdoClassificationNode {
  name: string;
  path?: string;
  structureType?: "area" | "iteration";
  hasChildren?: boolean;
  children?: AdoClassificationNode[];
  attributes?: Record<string, unknown>;
}

export interface AdoTemplateRef {
  id: string;
  name: string;
  description?: string;
  workItemTypeName?: string;
}

export interface AdoTemplate extends AdoTemplateRef {
  fields?: Record<string, unknown>;
}

export interface AdoTeamMember {
  isTeamAdmin?: boolean;
  identity?: {
    id?: string;
    displayName?: string;
    uniqueName?: string;
    isContainer?: boolean;
    inactive?: boolean;
  };
}

/** A control on a work item form: a field, or an extension bound to one. */
export interface AdoLayoutControl {
  id?: string;
  label?: string;
  controlType?: string;
  visible?: boolean;
  readOnly?: boolean;
  isContribution?: boolean;
  contribution?: {
    contributionId?: string;
    inputs?: Record<string, unknown>;
  };
}

export interface AdoLayoutGroup {
  id?: string;
  label?: string;
  visible?: boolean;
  isContribution?: boolean;
  controls?: AdoLayoutControl[];
}

/** The form ADO draws for a type, from the process it belongs to. */
export interface AdoFormLayout {
  pages?: {
    label?: string;
    pageType?: string;
    visible?: boolean;
    sections?: { id?: string; groups?: AdoLayoutGroup[] }[];
  }[];
  systemControls?: AdoLayoutControl[];
}

export interface AdoAttachmentRef {
  id: string;
  url: string;
}

/** One field as `workitemtypes/{type}/fields?$expand=all` returns it. */
export interface AdoTypeField {
  referenceName: string;
  name: string;
  alwaysRequired?: boolean;
  allowedValues?: unknown[];
  defaultValue?: unknown;
  helpText?: string;
}

/** One account-wide field definition, from `_apis/wit/fields`. */
export interface AdoField {
  referenceName?: string;
  type?: string;
  readOnly?: boolean;
  isIdentity?: boolean;
}

export interface AdoWiki {
  id: string;
  name: string;
  type?: string;
  projectId?: string;
}

export interface AdoRepo {
  name: string;
  remoteUrl?: string;
  webUrl?: string;
  defaultBranch?: string;
}

interface AdoWikiPage {
  path?: string;
  content?: string;
  remoteUrl?: string;
  subPages?: AdoWikiPage[];
}

type AdoList<T> = { value?: T[] };

export interface AdoClient {
  readonly orgUrl: string;
  getConnectionData(): Promise<AdoConnectionData>;
  listProjects(): Promise<{ id: string; name: string }[]>;
  getWorkItem(id: string): Promise<AdoWorkItem>;
  getWorkItemsBatch(ids: number[], fields?: string[]): Promise<AdoWorkItem[]>;
  getComments(project: string, id: string): Promise<AdoComment[]>;
  queryWorkItemIds(
    project: string,
    since?: string,
    top?: number,
  ): Promise<number[]>;
  getPullRequest(
    project: string,
    repoId: string,
    prId: string,
  ): Promise<AdoPullRequest>;
  getCommit(project: string, repoId: string, sha: string): Promise<AdoCommit>;
  listWorkItemTypes(project: string): Promise<AdoWorkItemType[]>;
  getTypeFields(project: string, type: string): Promise<AdoTypeField[]>;
  /**
   * Account-wide field definitions. `getTypeFields` returns what a type
   * requires and allows but no data type, so a field's widget comes from
   * joining the two on referenceName.
   */
  listFields(): Promise<AdoField[]>;
  /**
   * Applies a patch to an existing item. A `test` on /rev makes it refuse a
   * stale write.
   */
  updateWorkItem(id: string, patch: JsonPatchOp[]): Promise<AdoWorkItem>;
  /**
   * `validateOnly` runs the type's rules without saving, which is the only way
   * to learn about requirements that depend on other fields' values.
   */
  createWorkItem(
    project: string,
    type: string,
    patch: JsonPatchOp[],
    opts?: { validateOnly?: boolean },
  ): Promise<AdoWorkItem>;
  /**
   * A new, unsaved item of the type with the process's rules already applied:
   * the values ADO's own "New" form starts from.
   */
  getNewItemTemplate(project: string, type: string): Promise<AdoWorkItem>;
  listTypeCategories(project: string): Promise<AdoTypeCategory[]>;
  /**
   * Named properties, e.g. System.ProcessTemplateType: the process the form
   * comes from.
   */
  getProjectProperties(
    projectId: string,
    keys: string[],
  ): Promise<Record<string, unknown>>;
  getFormLayout(processId: string, typeRef: string): Promise<AdoFormLayout>;
  listTeams(project: string): Promise<AdoTeamRef[]>;
  getProject(project: string): Promise<{
    id: string;
    name: string;
    defaultTeam?: AdoTeamRef;
  }>;
  getTeamSettings(project: string, team: string): Promise<AdoTeamSettings>;
  listTeamIterations(
    project: string,
    team: string,
    timeframe?: "current",
  ): Promise<AdoTeamIteration[]>;
  getTeamFieldValues(
    project: string,
    team: string,
  ): Promise<AdoTeamFieldValues>;
  getClassificationTree(
    project: string,
    group: "Areas" | "Iterations",
    depth: number,
  ): Promise<AdoClassificationNode>;
  listTemplates(
    project: string,
    team: string,
    type?: string,
  ): Promise<AdoTemplateRef[]>;
  getTemplate(project: string, team: string, id: string): Promise<AdoTemplate>;
  listTeamMembers(project: string, team: string): Promise<AdoTeamMember[]>;
  uploadAttachment(
    project: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<AdoAttachmentRef>;
  listWikis(project?: string): Promise<AdoWiki[]>;
  listWikiPages(project: string, wiki: string): Promise<string[]>;
  getWikiPage(
    project: string,
    wiki: string,
    path: string,
  ): Promise<{ path: string; content: string; remoteUrl?: string }>;
  getWikiPageById(
    project: string,
    wiki: string,
    id: string | number,
  ): Promise<{ path: string; content: string; remoteUrl?: string }>;
  listRepos(project: string): Promise<AdoRepo[]>;
}

export function createAdoClient(connection: AdoCfg): AdoClient {
  if (!connection.baseUrl)
    throw badInput(
      "azure-devops connection needs a base_url like https://dev.azure.com/<org>",
    );
  const orgUrl = connection.baseUrl.replace(/\/$/, "");
  const token = connection.token || azureDevopsToken(connection.slug);
  const auth =
    "Basic " + rememberSecret(Buffer.from(`:${token}`).toString("base64"));

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = init?.method ?? "GET";
    const response = await sourceFetch(
      `Azure DevOps ${method} ${path}`,
      orgUrl + withVersion(path),
      {
        ...init,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      },
      { connection: connection.slug },
    );
    const text = await response.text();
    const trimmed = text.trim();
    if (!response.ok) {
      const hint =
        response.status === 401 ||
        response.status === 403 ||
        response.status === 203
          ? " - check that the PAT is valid and has the required scopes (Work Items, Wiki, Code)"
          : "";
      throw new Error(
        `Azure DevOps ${method} ${path} -> ${response.status} ${trimmed.slice(0, 2000)}${hint}`,
      );
    }
    if (!trimmed) return {} as T;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new Error(
        `Azure DevOps ${method} ${path} -> ${response.status} returned non-JSON - check that the PAT is valid and has the required scopes (Work Items, Wiki, Code)`,
      );
    }
    return JSON.parse(text) as T;
  }

  const proj = (project: string) => `/${encodeURIComponent(project)}`;
  const teamIn = (project: string, team: string) =>
    `${proj(project)}/${encodeURIComponent(team)}`;

  return {
    orgUrl,

    async getConnectionData() {
      return request<AdoConnectionData>(
        `/_apis/connectionData?api-version=${API_CONNECTION_DATA}`,
      );
    },

    async listProjects() {
      const response = await request<AdoList<{ id: string; name: string }>>(
        "/_apis/projects?$top=500",
      );
      return (response.value ?? []).map((p) => ({ id: p.id, name: p.name }));
    },

    async getWorkItem(id) {
      return request<AdoWorkItem>(
        `/_apis/wit/workitems/${encodeURIComponent(String(id))}?$expand=all`,
      );
    },

    async getWorkItemsBatch(ids, fields) {
      const workItems: AdoWorkItem[] = [];
      for (let i = 0; i < ids.length; i += WORK_ITEM_BATCH_SIZE) {
        const chunk = ids.slice(i, i + WORK_ITEM_BATCH_SIZE);
        const params = new URLSearchParams({
          ids: chunk.join(","),
          errorPolicy: "omit",
        });
        if (fields?.length) params.set("fields", fields.join(","));
        const response = await request<AdoList<AdoWorkItem>>(
          `/_apis/wit/workitems?${params.toString()}`,
        );
        workItems.push(...(response.value ?? []));
      }
      return workItems;
    },

    async getComments(project, id) {
      const comments: AdoComment[] = [];
      let continuation: string | undefined;
      // A server that echoes the same continuation token would otherwise spin
      // here for as long as the process runs.
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          "api-version": API_COMMENTS,
          $top: "200",
        });
        if (continuation) params.set("continuationToken", continuation);
        const response = await request<{
          comments?: AdoComment[];
          continuationToken?: string;
        }>(
          `${proj(project)}/_apis/wit/workItems/${encodeURIComponent(String(id))}/comments?${params.toString()}`,
        );
        comments.push(...(response.comments ?? []));
        continuation = response.continuationToken || undefined;
        if (!continuation) break;
      }
      return comments;
    },

    async queryWorkItemIds(project, since, top) {
      const where = [`[System.TeamProject] = @project`];
      if (since) {
        const sinceDate = new Date(since);
        if (Number.isNaN(sinceDate.getTime()))
          throw badInput(`invalid updatedSince date: ${since}`);
        where.push(`[System.ChangedDate] >= '${sinceDate.toISOString()}'`);
      }
      const query = `Select [System.Id] From WorkItems Where ${where.join(" And ")} Order By [System.ChangedDate] Asc`;
      const params = new URLSearchParams({
        timePrecision: "true",
        $top: String(top ?? 200),
      });
      const response = await request<{ workItems?: { id: number }[] }>(
        `${proj(project)}/_apis/wit/wiql?${params.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        },
      );
      return (response.workItems ?? []).map((w) => Number(w.id));
    },

    async getPullRequest(project, repoId, prId) {
      return request<AdoPullRequest>(
        `${proj(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullrequests/${encodeURIComponent(String(prId))}`,
      );
    },

    async getCommit(project, repoId, sha) {
      return request<AdoCommit>(
        `${proj(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(sha)}`,
      );
    },

    async listWorkItemTypes(project) {
      const response = await request<AdoList<AdoWorkItemType>>(
        `${proj(project)}/_apis/wit/workitemtypes`,
      );
      return response.value ?? [];
    },

    async listFields() {
      const response = await request<AdoList<AdoField>>(`/_apis/wit/fields`);
      return response.value ?? [];
    },

    async getTypeFields(project, type) {
      const response = await request<AdoList<AdoTypeField>>(
        `${proj(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?$expand=all`,
      );
      return response.value ?? [];
    },

    async updateWorkItem(id, patch) {
      return request<AdoWorkItem>(
        `/_apis/wit/workitems/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(patch),
        },
      );
    },

    async createWorkItem(project, type, patch, opts) {
      return request<AdoWorkItem>(
        `${proj(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}${opts?.validateOnly ? "?validateOnly=true" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(patch),
        },
      );
    },

    async getNewItemTemplate(project, type) {
      return request<AdoWorkItem>(
        `${proj(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
      );
    },

    async listTypeCategories(project) {
      const response = await request<AdoList<AdoTypeCategory>>(
        `${proj(project)}/_apis/wit/workitemtypecategories`,
      );
      return response.value ?? [];
    },

    async getProjectProperties(projectId, keys) {
      const response = await request<AdoList<{ name: string; value: unknown }>>(
        `/_apis/projects/${encodeURIComponent(projectId)}/properties?keys=${keys.map(encodeURIComponent).join(",")}&api-version=${API_PROJECT_PROPERTIES}`,
      );
      return Object.fromEntries(
        (response.value ?? []).map((p) => [p.name, p.value]),
      );
    },

    async getFormLayout(processId, typeRef) {
      return request<AdoFormLayout>(
        `/_apis/work/processes/${encodeURIComponent(processId)}/workItemTypes/${encodeURIComponent(typeRef)}/layout`,
      );
    },

    async listTeams(project) {
      const response = await request<AdoList<AdoTeamRef>>(
        `/_apis/projects/${encodeURIComponent(project)}/teams?$top=100`,
      );
      return response.value ?? [];
    },

    async getProject(project) {
      return request<{ id: string; name: string; defaultTeam?: AdoTeamRef }>(
        `/_apis/projects/${encodeURIComponent(project)}`,
      );
    },

    async getTeamSettings(project, team) {
      return request<AdoTeamSettings>(
        `${teamIn(project, team)}/_apis/work/teamsettings`,
      );
    },

    async listTeamIterations(project, team, timeframe) {
      const response = await request<AdoList<AdoTeamIteration>>(
        `${teamIn(project, team)}/_apis/work/teamsettings/iterations${timeframe ? `?$timeframe=${timeframe}` : ""}`,
      );
      return response.value ?? [];
    },

    async getTeamFieldValues(project, team) {
      return request<AdoTeamFieldValues>(
        `${teamIn(project, team)}/_apis/work/teamsettings/teamfieldvalues`,
      );
    },

    async getClassificationTree(project, group, depth) {
      return request<AdoClassificationNode>(
        `${proj(project)}/_apis/wit/classificationnodes/${group}?$depth=${depth}`,
      );
    },

    async listTemplates(project, team, type) {
      const response = await request<AdoList<AdoTemplateRef>>(
        `${teamIn(project, team)}/_apis/wit/templates${type ? `?workitemtypename=${encodeURIComponent(type)}` : ""}`,
      );
      return response.value ?? [];
    },

    async getTemplate(project, team, id) {
      return request<AdoTemplate>(
        `${teamIn(project, team)}/_apis/wit/templates/${encodeURIComponent(id)}`,
      );
    },

    async listTeamMembers(project, team) {
      const response = await request<AdoList<AdoTeamMember>>(
        `/_apis/projects/${encodeURIComponent(project)}/teams/${encodeURIComponent(team)}/members?$top=500`,
      );
      return response.value ?? [];
    },

    async uploadAttachment(project, fileName, bytes) {
      return request<AdoAttachmentRef>(
        `${proj(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes,
        },
      );
    },

    async listWikis(project) {
      const scope = project ? proj(project) : "";
      const response = await request<AdoList<AdoWiki>>(
        `${scope}/_apis/wiki/wikis`,
      );
      return response.value ?? [];
    },

    async listWikiPages(project, wiki) {
      const params = new URLSearchParams({
        path: "/",
        recursionLevel: "full",
      });
      const response = await request<AdoWikiPage>(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages?${params.toString()}`,
      );
      const paths: string[] = [];
      const walk = (page: AdoWikiPage | undefined) => {
        if (!page) return;
        if (page.path) paths.push(page.path);
        for (const sub of page.subPages ?? []) walk(sub);
      };
      walk(response);
      return paths;
    },

    async getWikiPage(project, wiki, path) {
      const params = new URLSearchParams({
        path,
        includeContent: "true",
      });
      const response = await request<AdoWikiPage>(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages?${params.toString()}`,
      );
      return {
        path: response.path ?? path,
        content: response.content ?? "",
        remoteUrl: response.remoteUrl,
      };
    },

    /**
     * The id a wiki URL carries (.../_wiki/wikis/foo.wiki/1648/Start). Worth its
     * own call because the trailing segment of that URL is a display slug, not
     * the page path - dashes where the path has spaces - so it does not round-trip
     * through the path endpoint.
     */
    async getWikiPageById(project, wiki, id) {
      const response = await request<AdoWikiPage>(
        `${proj(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki)}/pages/${encodeURIComponent(String(id))}?includeContent=true`,
      );
      return {
        path: response.path ?? "",
        content: response.content ?? "",
        remoteUrl: response.remoteUrl,
      };
    },

    async listRepos(project) {
      const response = await request<AdoList<AdoRepo>>(
        `${proj(project)}/_apis/git/repositories`,
      );
      return response.value ?? [];
    },
  };
}
