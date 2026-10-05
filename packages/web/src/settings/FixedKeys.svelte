<script lang="ts">
  import RefList from "./RefList.svelte";

  const FIXED: { keys: string[]; what: string }[] = [
    { keys: ["ctrl+k"], what: "focus search / composer" },
    { keys: ["↑", "↓", "j", "k"], what: "move the cursor in a list" },
    { keys: ["⏎"], what: "open the highlighted row" },
    { keys: ["esc", "backspace"], what: "back / close" },
    { keys: ["⏎", "shift+⏎"], what: "send / new line, in chat" },
    { keys: ["/"], what: "commands, in the chat composer" },
  ];
</script>

<RefList rows={FIXED} />
