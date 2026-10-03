/**
 * Everything a field has to say, shown on the info mark beside its label.
 *
 * These carry rules, not sample values. A placeholder that looks like a name
 * reads as data the record already holds, and a quoted example invites input
 * that `csv` below stores with the quote marks on.
 */
export const INFO = {
  slug: "Lowercase id, derived from the name. Used by URLs, filters and the agent. Not shown in lists.",
  /* Three tables carry aliases and they do not all mean the same thing —
     a customer's are trading names, not email domains. See catalog/customers.ts. */
  aliases: {
    product:
      "Alternate names, comma-separated, no quotes. Resolved like the slug.",
    component:
      "Alternate names, comma-separated, no quotes. Also match entries tagged with the variant.",
    customer: "Trading names, comma-separated, no quotes. Not email domains.",
  },
  emailDomains:
    "Sender domains, comma-separated, bare (no addresses). Include partners. A domain on two customers matches neither.",
  parent: "Parent node. Derives product_area paths.",
  team: "Owning team.",
  project:
    "Source project: ADO project, Freshdesk group, or GitHub owner/repo. Maps its items, wiki, code.",
  area: "ADO area path prefix. Items under it file here; longest prefix wins.",
  repoComponent: "Implemented component. Narrows code search.",
};
