/**
 * Everything a field has to say, shown on the info mark beside its label.
 *
 * These carry rules, not sample values. A placeholder that looks like a name
 * reads as data the record already holds, and a quoted example invites input
 * that `csv` stores with the quote marks on.
 */
export const INFO = {
  slug: "lowercase id, derived from the name. used by URLs, filters and the agent. not shown in lists",
  // Three tables carry aliases and they do not all mean the same thing - a
  // customer's are trading names, not email domains. See catalog/customers.ts.
  aliases: {
    product:
      "alternate names, comma-separated, no quotes. resolved like the slug",
    component:
      "alternate names, comma-separated, no quotes. also match entries tagged with the variant",
    customer: "trading names, comma-separated, no quotes. not email domains",
  },
  emailDomains:
    "sender domains, comma-separated, bare (no addresses). include partners. a domain on two customers matches neither",
  parent: "parent node. derives product_area paths",
  team: "owning team",
  project:
    "source project: ADO project, Freshdesk group, or GitHub owner/repo. maps its items, wiki, code",
  area: "ADO area path prefix. items under it file here; longest prefix wins",
};
