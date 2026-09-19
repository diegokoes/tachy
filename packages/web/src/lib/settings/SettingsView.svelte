<script lang="ts">
  import { navigate, segment } from "../router.svelte";
  import SectionedPage, {
    type PageSection,
  } from "../sections/SectionedPage.svelte";
  import { capture, rebind } from "./rebind.svelte";
  import Account from "./Account.svelte";
  import Agent from "./Agent.svelte";
  import Keys from "./Keys.svelte";
  import Appearance from "./Appearance.svelte";
  import Fonts from "./Fonts.svelte";
  import NavKeys from "./NavKeys.svelte";
  import SubnavKeys from "./SubnavKeys.svelte";
  import VimKeys from "./VimKeys.svelte";
  import FixedKeys from "./FixedKeys.svelte";

  const SECTIONS: PageSection[] = [
    { key: "account", label: "account", view: Account, eager: true },
    { key: "agent", label: "agent", view: Agent },
    { key: "keys", label: "keys", view: Keys },
    { key: "appearance", label: "appearance", view: Appearance },
    { key: "fonts", label: "fonts", view: Fonts },
    { key: "section-keys", label: "section keys", view: NavKeys },
    { key: "subnav-keys", label: "subnav keys", view: SubnavKeys },
    { key: "vim", label: "vim controls", view: VimKeys },
    { key: "reference", label: "fixed keys", view: FixedKeys },
  ];

  /** Legacy tab URLs survive in bookmarks and history; each lands on the
   *  section that holds its content. */
  const MOVED: Record<string, string> = {
    ui: "appearance",
    theme: "appearance",
    keybinds: "section-keys",
  };

  const at = $derived.by(() => {
    const seg = segment(1);
    if (!seg) return undefined;
    return MOVED[seg] ?? seg;
  });

  /* One listener for the whole page. The two rebind sections mount and unmount
     with the scroll, and a listener per section would record the same press
     into both of them. */
</script>

<svelte:window onkeydown={rebind.target ? capture : undefined} />

<SectionedPage sections={SECTIONS} label="settings sections" {at}
  onactive={(key) => navigate(`/settings/${key}`, { replace: true })} />
