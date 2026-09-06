/**
 * Everything a field has to say, shown on the info mark beside its label.
 *
 * These carry rules, not sample values. A placeholder standing in as a made-up
 * name reads as data the record already holds, and one of ours was worse than
 * that: it showed a quoted multi-word alias, which `csv` below would have
 * stored with the quote marks still on it.
 */
export const INFO = {
  slug: "Stable lowercase machine id, derived from the name. Filters, URLs and the agent go through it.",
  /* Three tables carry aliases and they do not all mean the same thing —
     a customer's are trading names, not email domains. See catalog/customers.ts. */
  aliases: {
    product:
      "Other names this product answers to. Separate them with commas: everything between two commas is one alias, so a name with spaces needs no quotes. The agent and the API resolve them like the slug.",
    component:
      "Other names this component answers to. Separate them with commas: everything between two commas is one alias, so a name with spaces needs no quotes. They also match knowledge and reference entries tagged with the variant.",
    customer:
      "Other NAMES this account trades under, not email domains, which have their own field. Separate them with commas: everything between two commas is one alias, so a name with spaces needs no quotes.",
  },
  emailDomains:
    "Domains whose senders are this customer, separated by commas, including a partner or distributor who raises tickets on their behalf. Bare domains, not addresses. Incoming tickets are attributed by the requester's domain, and a domain listed on two customers deliberately matches neither, so a shared integrator's domain belongs to nobody.",
  parent:
    "The parent in the hierarchy. product_area paths (Product / Parent / Component) are derived from it.",
  team: "The owning team. One team can own many products.",
  project:
    "One project as its source knows it: an Azure DevOps project, a Freshdesk group, a GitHub owner/repo. Registering it is what tells tachy where its items, wiki and code belong.",
  area: "An Azure DevOps area path prefix. Items under it are filed on this component automatically; the longest matching prefix wins.",
  repoComponent:
    "The component this repo implements, which narrows code search to that part. A question about one part of the product then searches that repo instead of everything.",
};
