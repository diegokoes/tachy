const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const whole = (f: string) => /^\d+$/.test(f);

function weekdays(field: string): string | null {
  if (field === "1-5") return "weekdays";
  if (field === "0,6" || field === "6,0") return "weekends";
  const days = field.split(",");
  if (!days.every((d) => /^[0-7]$/.test(d))) return null;
  return days.map((d) => DAYS[Number(d) % 7]).join(", ");
}

/**
 * A cron expression as a person would say it, for the common shapes; anything
 * else comes back as typed.
 */
export function describeSchedule(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = fields;
  if (dom !== "*" || mon !== "*") return cron;

  const step = /^\*\/(\d+)$/.exec(min);
  if (step && hour === "*" && dow === "*")
    return `every ${Number(step[1])} min`;
  if (min === "*" && hour === "*" && dow === "*") return "every minute";
  if (whole(min) && hour === "*" && dow === "*")
    return Number(min) === 0
      ? "every hour"
      : `every hour at :${pad(Number(min))}`;
  if (whole(min) && whole(hour)) {
    const at = `${pad(Number(hour))}:${pad(Number(min))}`;
    if (dow === "*") return `daily at ${at}`;
    const days = weekdays(dow);
    return days ? `${days} at ${at}` : cron;
  }
  return cron;
}
