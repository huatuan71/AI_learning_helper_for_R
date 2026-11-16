raw <- c("high", "low", "mid", "high", "mid", "low", "high", "mid", "other", "high", NA, "mid")
satisfaction <- factor(raw, levels = c("low", "mid", "high"),
                       labels = c("Low", "Mid", "High"), ordered = TRUE)
invalid <- !is.na(raw) & is.na(satisfaction)
print(satisfaction)
print(table(satisfaction, useNA = "ifany"))
print(raw[invalid])
