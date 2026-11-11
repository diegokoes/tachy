<script lang="ts">
  import { navigate, segment } from "../shell/router.svelte";
  import { setSubnav } from "../shell/subnav.svelte";
  import { libraryTabPath, libraryTabs } from "../library/tabs";
  import { reviewTotal } from "../review/review.svelte";
  import { landingScope, loadWikis, wikis } from "../wiki/wikis.svelte";
  import { showCustomer } from "../terms";
  import CustomerList from "./CustomerList.svelte";
  import CustomerPage from "./CustomerPage.svelte";

  const slug = $derived(segment(1));
  const unit = $derived(segment(2) ?? null);

  async function openTab(tab: string) {
    if (tab !== "customers" && !wikis.loaded) await loadWikis();
    navigate(libraryTabPath(tab, landingScope()));
  }

  $effect(() =>
    setSubnav({
      items: libraryTabs({
        customers: showCustomer(),
        waiting: reviewTotal(),
      }),
      active: "customers",
      onpick: (tab) => void openTab(tab),
    }),
  );
</script>

{#if slug}
  {#key slug}<CustomerPage {slug} {unit} />{/key}
{:else}
  <CustomerList />
{/if}
