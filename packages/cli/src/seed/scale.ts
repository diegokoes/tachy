export const SCALE_NAMES = ["small", "medium", "large"] as const;
export type ScaleName = (typeof SCALE_NAMES)[number];

export interface Volumes {
  teams: number;
  products: number;
  users: number;
  components: number;
  labels: number;
  resolutionPatterns: number;
  customers: number;
  customerComponents: number;
  customerFacts: number;
  sourceProjects: number;
  projectAreas: number;
  workItems: number;
  workItemMessages: number;
  workItemLinks: number;
  knowledgeEntries: number;
  knowledgeFeedback: number;
  referenceDocs: number;
  referenceChunks: number;
  repos: number;
  repoFiles: number;
  codeChunks: number;
  analysisRuns: number;
  artifacts: number;
  generatedOutputs: number;
}

/**
 * `small` is what the test suite runs; `medium` is the default for a dev box;
 * `large` is for finding where things break. Message/chunk counts are totals,
 * spread over their parents.
 */
export const SCALES: Record<ScaleName, Volumes> = {
  small: {
    teams: 2,
    products: 3,
    users: 8,
    components: 12,
    labels: 10,
    resolutionPatterns: 8,
    customers: 10,
    customerComponents: 20,
    customerFacts: 30,
    sourceProjects: 4,
    projectAreas: 8,
    workItems: 200,
    workItemMessages: 600,
    workItemLinks: 40,
    knowledgeEntries: 150,
    knowledgeFeedback: 100,
    referenceDocs: 40,
    referenceChunks: 160,
    repos: 2,
    repoFiles: 200,
    codeChunks: 800,
    analysisRuns: 200,
    artifacts: 6,
    generatedOutputs: 10,
  },
  medium: {
    teams: 4,
    products: 8,
    users: 40,
    components: 60,
    labels: 40,
    resolutionPatterns: 15,
    customers: 60,
    customerComponents: 200,
    customerFacts: 300,
    sourceProjects: 12,
    projectAreas: 40,
    workItems: 5_000,
    workItemMessages: 20_000,
    workItemLinks: 1_200,
    knowledgeEntries: 4_000,
    knowledgeFeedback: 2_000,
    referenceDocs: 600,
    referenceChunks: 2_400,
    repos: 8,
    repoFiles: 3_000,
    codeChunks: 15_000,
    analysisRuns: 3_000,
    artifacts: 20,
    generatedOutputs: 100,
  },
  large: {
    teams: 8,
    products: 20,
    users: 150,
    components: 250,
    labels: 120,
    resolutionPatterns: 25,
    customers: 300,
    customerComponents: 1_200,
    customerFacts: 2_000,
    sourceProjects: 30,
    projectAreas: 150,
    workItems: 40_000,
    workItemMessages: 160_000,
    workItemLinks: 8_000,
    knowledgeEntries: 25_000,
    knowledgeFeedback: 12_000,
    referenceDocs: 4_000,
    referenceChunks: 16_000,
    repos: 25,
    repoFiles: 15_000,
    codeChunks: 60_000,
    analysisRuns: 20_000,
    artifacts: 60,
    generatedOutputs: 500,
  },
};

/**
 * Ceilings the generators assume. A cross-product table cannot hold more rows
 * than its two sides multiplied, and every one of these is enumerated rather
 * than sampled, so exceeding a ceiling would loop past the end of the product
 * instead of failing on a duplicate key.
 */
export function assertCoherent(v: Volumes, name: ScaleName): void {
  const bad = (what: string, limit: number, got: number) => {
    throw new Error(
      `scale '${name}': ${what} is ${got}, above the ${limit} its inputs allow`,
    );
  };
  if (v.customerComponents > v.customers * v.components)
    bad("customerComponents", v.customers * v.components, v.customerComponents);
  if (v.projectAreas > v.sourceProjects * 40)
    bad("projectAreas", v.sourceProjects * 40, v.projectAreas);
  if (v.workItemMessages < v.workItems)
    bad("workItems", v.workItemMessages, v.workItems);
  if (v.components < v.products) bad("products", v.components, v.products);
}

for (const name of SCALE_NAMES) assertCoherent(SCALES[name], name);
