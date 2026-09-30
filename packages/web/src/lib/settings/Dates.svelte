<script lang="ts">
  import { CLOCKS, DATE_ORDERS, DATE_ORDER_LABELS, type DateFormat } from "@tachy/contract";
  import { dateFormat, loadDateFormat, setDatePart } from "../dates.svelte";
  import { errText } from "../resource.svelte";
  import { Note } from "../tui";
  import Choice from "./Choice.svelte";
  import Row from "./Row.svelte";
  import Rows from "./Rows.svelte";

  const ORDERS = DATE_ORDERS.map((order) => ({ value: order, label: DATE_ORDER_LABELS[order] }));
  const CLOCK_OPTIONS = CLOCKS.map((c) => ({ value: c, label: c }));

  let error = $state<string | null>(null);

  void loadDateFormat();

  const pick =
    <P extends keyof DateFormat>(part: P) =>
    async (value: DateFormat[P]) => {
      error = null;
      try {
        await setDatePart(part, value);
      } catch (e) {
        error = errText(e);
      }
    };
</script>

<Rows>
  <Row label="date" hint="times are shown in UTC">
    <Choice label="date" options={ORDERS} value={dateFormat.order} onpick={pick("order")} />
  </Row>

  <Row label="clock">
    <Choice label="clock" options={CLOCK_OPTIONS} value={dateFormat.clock} onpick={pick("clock")} />
  </Row>
</Rows>

{#if error}<Note tone="danger">{error}</Note>{/if}
