<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    CLOCKS,
    DATE_ORDERS,
    DEFAULT_DATE_FORMAT,
    formatDay,
    type DateFormat,
  } from "@tachy/contract";
  import {
    dateFormat,
    dateFormatOwned,
    fmtDateTime,
    loadDateFormat,
    resetDatePart,
    setDatePart,
  } from "../dates.svelte";
  import { errText } from "../resource.svelte";
  import { Button, Note } from "../tui";
  import Choice from "./Choice.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const SAMPLE = "2026-09-29T14:05:00Z";
  const ORDERS = DATE_ORDERS.map((order) => ({
    value: order,
    label: formatDay(SAMPLE, { ...DEFAULT_DATE_FORMAT, order }),
  }));
  const CLOCK_OPTIONS = CLOCKS.map((c) => ({ value: c, label: c }));

  let error = $state<string | null>(null);
  let now = $state(Date.now());
  const tick = setInterval(() => (now = Date.now()), 15_000);
  onDestroy(() => clearInterval(tick));

  void loadDateFormat();

  async function run(fn: () => Promise<unknown>) {
    error = null;
    try {
      await fn();
    } catch (e) {
      error = errText(e);
    }
  }

  const pick =
    <P extends keyof DateFormat>(part: P) =>
    (value: DateFormat[P]) =>
      run(() => setDatePart(part, value));
</script>

{#snippet reset(part: keyof DateFormat, name: string)}
  <span class="slot">
    {#if dateFormatOwned[part]}
      <Button
        variant="ghost"
        square
        icon="reset"
        title="reset"
        aria-label="reset {name}"
        onclick={() => run(() => resetDatePart(part))}
      />
    {/if}
  </span>
{/snippet}

<Rows>
  <Row label="date">
    <Choice label="date" options={ORDERS} value={dateFormat.order} onpick={pick("order")} />
    {#snippet actions()}{@render reset("order", "date")}{/snippet}
  </Row>

  <Row label="clock">
    <Choice label="clock" options={CLOCK_OPTIONS} value={dateFormat.clock} onpick={pick("clock")} />
    {#snippet actions()}{@render reset("clock", "clock")}{/snippet}
  </Row>

  <Row label="now" hint="times are shown in UTC">
    <span class="now">{fmtDateTime(new Date(now).toISOString())}</span>
  </Row>
</Rows>

{#if error}<Note tone="danger">{error}</Note>{/if}

<style>
  .now {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .slot {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--row-h);
  }
</style>
