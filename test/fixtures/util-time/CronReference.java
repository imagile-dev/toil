import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.function.Predicate;

/**
 * The reference table for `util time cron` (cron-reference.json), worked out
 * a second way: Java's own java.time and its own time zone data, walking
 * forward minute by minute (second by second for Quartz seconds) and keeping
 * each wall clock the first time it occurs. Each schedule is written here as a
 * plain Java predicate with java.time's adjusters, not parsed, so the table
 * shares no code with the TypeScript it checks. Jenkins's H values come from
 * the real java.util.Random, seeded as Jenkins's Hash.from seeds it.
 *
 * Regenerate with a JDK 17 or later:
 *   java test/fixtures/util-time/CronReference.java > test/fixtures/util-time/cron-reference.json
 */
public class CronReference {
  record Row(String id, String expression, String dialect, String zone, String from, int count, String job, boolean seconds, Predicate<LocalDateTime> p) {}

  static Random jenkins(String seed) throws Exception {
    byte[] d = MessageDigest.getInstance("MD5").digest(seed.getBytes(StandardCharsets.UTF_8));
    for (int i = 8; i < d.length; i++) d[i % 8] ^= d[i];
    long l = 0;
    for (int i = 0; i < 8; i++) l = (l << 8) + (d[i] & 0xFF);
    return new Random(l);
  }

  static int dow(LocalDateTime t) { return t.getDayOfWeek().getValue() % 7; } // 0 = Sunday
  static boolean at(LocalDateTime t, int h, int m) { return t.getHour() == h && t.getMinute() == m && t.getSecond() == 0; }
  static boolean weekday(LocalDate d) { return d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY; }
  static LocalDate nearestWeekday(LocalDate first, int n) {
    LocalDate last = first.with(TemporalAdjusters.lastDayOfMonth());
    if (n > last.getDayOfMonth()) return null;
    LocalDate d = first.withDayOfMonth(n);
    if (d.getDayOfWeek() == DayOfWeek.SATURDAY) return n == 1 ? d.plusDays(2) : d.minusDays(1);
    if (d.getDayOfWeek() == DayOfWeek.SUNDAY) return n == last.getDayOfMonth() ? d.minusDays(2) : d.plusDays(1);
    return d;
  }

  public static void main(String[] args) throws Exception {
    List<Row> rows = new ArrayList<>();
    // Standard five-field cron.
    rows.add(new Row("std-spring-gap", "30 2 * * *", "standard", "America/New_York", "2026-03-07T00:00:00Z", 3, null, false, t -> at(t, 2, 30)));
    rows.add(new Row("std-fall-overlap", "30 1 * * *", "standard", "America/New_York", "2026-10-31T00:00:00Z", 3, null, false, t -> at(t, 1, 30)));
    rows.add(new Row("std-hourly-overlap", "0 * * * *", "standard", "America/New_York", "2026-11-01T04:00:00Z", 4, null, false, t -> t.getMinute() == 0 && t.getSecond() == 0));
    rows.add(new Row("std-workhours-london", "*/15 9-17 * * 1-5", "standard", "Europe/London", "2026-03-27T17:00:00Z", 6, null, false,
        t -> t.getMinute() % 15 == 0 && t.getSecond() == 0 && t.getHour() >= 9 && t.getHour() <= 17 && dow(t) >= 1 && dow(t) <= 5));
    rows.add(new Row("std-leap-day", "0 0 29 2 *", "standard", "UTC", "2026-01-01T00:00:00Z", 3, null, false, t -> at(t, 0, 0) && t.getMonthValue() == 2 && t.getDayOfMonth() == 29));
    rows.add(new Row("std-dom-or-dow", "0 9 1-7 * MON", "standard", "UTC", "2026-06-01T00:00:00Z", 8, null, false,
        t -> at(t, 9, 0) && (t.getDayOfMonth() <= 7 || dow(t) == 1)));
    rows.add(new Row("std-sunday-7", "0 0 * * 7", "standard", "Asia/Kolkata", "2026-01-01T00:00:00Z", 3, null, false, t -> at(t, 0, 0) && dow(t) == 0));
    rows.add(new Row("std-sydney-gap", "0 2 * * *", "standard", "Australia/Sydney", "2026-10-02T00:00:00Z", 3, null, false, t -> at(t, 2, 0)));
    rows.add(new Row("std-weekly-macro", "@weekly", "standard", "UTC", "2026-12-25T00:00:00Z", 3, null, false, t -> at(t, 0, 0) && dow(t) == 0));
    rows.add(new Row("std-star-step-dom", "0 12 */10 * 5", "standard", "UTC", "2026-01-01T00:00:00Z", 4, null, false,
        t -> at(t, 12, 0) && (t.getDayOfMonth() - 1) % 10 == 0 && dow(t) == 5));
    // Quartz.
    rows.add(new Row("qz-second-monday", "0 0 12 ? * MON#2", "quartz", "Europe/London", "2026-01-01T00:00:00Z", 4, null, false,
        t -> at(t, 12, 0) && t.toLocalDate().equals(t.toLocalDate().with(TemporalAdjusters.dayOfWeekInMonth(2, DayOfWeek.MONDAY)))));
    rows.add(new Row("qz-last-day-leap", "0 15 10 L * ?", "quartz", "UTC", "2028-01-15T00:00:00Z", 4, null, false,
        t -> at(t, 10, 15) && t.toLocalDate().equals(t.toLocalDate().with(TemporalAdjusters.lastDayOfMonth()))));
    rows.add(new Row("qz-last-weekday", "0 0 9 LW * ?", "quartz", "UTC", "2026-01-01T00:00:00Z", 4, null, false, t -> {
      LocalDate d = t.toLocalDate().with(TemporalAdjusters.lastDayOfMonth());
      while (!weekday(d)) d = d.minusDays(1);
      return at(t, 9, 0) && t.toLocalDate().equals(d);
    }));
    rows.add(new Row("qz-nearest-15", "0 0 9 15W * ?", "quartz", "UTC", "2026-01-01T00:00:00Z", 8, null, false,
        t -> at(t, 9, 0) && t.toLocalDate().equals(nearestWeekday(t.toLocalDate().withDayOfMonth(1), 15))));
    rows.add(new Row("qz-nearest-1", "0 0 0 1W * ?", "quartz", "UTC", "2026-07-15T00:00:00Z", 3, null, false,
        t -> at(t, 0, 0) && t.toLocalDate().equals(nearestWeekday(t.toLocalDate().withDayOfMonth(1), 1))));
    rows.add(new Row("qz-last-friday", "0 0 18 ? * 6L", "quartz", "America/Chicago", "2026-01-01T00:00:00Z", 4, null, false,
        t -> at(t, 18, 0) && t.toLocalDate().equals(t.toLocalDate().with(TemporalAdjusters.lastInMonth(DayOfWeek.FRIDAY)))));
    rows.add(new Row("qz-sunday-gap-year", "0 30 2 ? * SUN 2026", "quartz", "America/New_York", "2026-02-25T00:00:00Z", 4, null, false,
        t -> at(t, 2, 30) && dow(t) == 0 && t.getYear() == 2026));
    rows.add(new Row("qz-last-minus-2", "0 0 0 L-2 * ?", "quartz", "UTC", "2027-01-01T00:00:00Z", 3, null, false,
        t -> at(t, 0, 0) && t.getDayOfMonth() == t.toLocalDate().lengthOfMonth() - 2));
    rows.add(new Row("qz-every-20s", "*/20 * * * * ?", "quartz", "UTC", "2026-05-05T05:05:05Z", 4, null, true, t -> t.getSecond() % 20 == 0));
    // Jenkins: the H values are drawn here from java.util.Random itself.
    {
      Random r = jenkins("platform/api-build");
      int m = r.nextInt(60), h = r.nextInt(8);
      rows.add(new Row("jk-weekday-early", "H H(0-7) * * 1-5", "jenkins", "UTC", "2026-10-01T00:00:00Z", 5, "platform/api-build", false, t -> at(t, h, m) && dow(t) >= 1 && dow(t) <= 5));
    }
    {
      Random r = jenkins("folder/nightly");
      int start = r.nextInt(15);
      rows.add(new Row("jk-quarter-hour", "H/15 * * * *", "jenkins", "UTC", "2026-10-01T00:00:00Z", 5, "folder/nightly", false, t -> t.getMinute() % 15 == start && t.getSecond() == 0));
    }
    {
      Random r = jenkins("imagile/release");
      int m = r.nextInt(60), h = r.nextInt(24);
      rows.add(new Row("jk-daily-macro", "@daily", "jenkins", "America/New_York", "2026-11-01T00:00:00Z", 3, "imagile/release", false, t -> at(t, h, m)));
    }
    {
      Random r = jenkins("x");
      int m = r.nextInt(60), h = r.nextInt(24);
      rows.add(new Row("jk-dom-and-dow", "H H 1,15 * 1", "jenkins", "UTC", "2026-01-01T00:00:00Z", 3, "x", false,
          t -> at(t, h, m) && (t.getDayOfMonth() == 1 || t.getDayOfMonth() == 15) && dow(t) == 1));
    }

    StringBuilder out = new StringBuilder("[\n");
    for (int i = 0; i < rows.size(); i++) {
      Row row = rows.get(i);
      ZoneId zone = ZoneId.of(row.zone());
      Instant t = Instant.parse(row.from()).truncatedTo(row.seconds() ? ChronoUnit.SECONDS : ChronoUnit.MINUTES).plus(1, row.seconds() ? ChronoUnit.SECONDS : ChronoUnit.MINUTES);
      Instant horizon = Instant.parse(row.from()).plus(366L * 60, ChronoUnit.DAYS);
      // Wall clocks only go backwards in an overlap, so one seen before is one no later than the latest seen.
      LocalDateTime latest = LocalDateTime.MIN;
      List<String> runs = new ArrayList<>();
      while (runs.size() < row.count() && t.isBefore(horizon)) {
        LocalDateTime wall = ZonedDateTime.ofInstant(t, zone).toLocalDateTime();
        if (wall.isAfter(latest)) {
          latest = wall;
          if (row.p().test(wall)) runs.add(t.toString());
        }
        t = t.plus(1, row.seconds() ? ChronoUnit.SECONDS : ChronoUnit.MINUTES);
      }
      out.append(String.format("  { \"id\": \"%s\", \"expression\": \"%s\", \"dialect\": \"%s\", \"zone\": \"%s\", \"from\": \"%s\", \"count\": %d, %s\"runs\": [%s] }%s\n",
          row.id(), row.expression(), row.dialect(), row.zone(), row.from(), row.count(), row.job() == null ? "" : "\"job\": \"" + row.job() + "\", ",
          String.join(", ", runs.stream().map(s -> "\"" + s + "\"").toList()), i + 1 < rows.size() ? "," : ""));
    }
    System.out.print(out.append("]\n"));
  }
}
