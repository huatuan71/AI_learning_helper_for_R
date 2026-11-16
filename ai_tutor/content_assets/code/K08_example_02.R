raw_time <- c("2026-10-31 23:30:00", "2026-11-01 00:30:00",
              "2026-11-01 08:00:00", "2026-11-02 08:00:00",
              "2026-11-03 08:00:00", "2026-11-04 08:00:00",
              "2026-11-05 08:00:00", "2026-11-06 08:00:00",
              "2026-11-07 08:00:00", "2026-11-08 08:00:00")
times <- as.POSIXct(raw_time, format = "%Y-%m-%d %H:%M:%S", tz = "Asia/Shanghai")
print(table(format(times, "%Y-%m", tz = "Asia/Shanghai")))
print(format(times[1], "%Y-%m-%d %H:%M", tz = "UTC"))
print(as.numeric(difftime(times[2], times[1], units = "hours")))
parts <- as.POSIXlt(times, tz = "Asia/Shanghai")
print(parts$mon + 1L)
