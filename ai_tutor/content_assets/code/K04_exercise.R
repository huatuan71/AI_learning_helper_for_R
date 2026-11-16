raw_scores <- c("60", " 64", "68 ", "72", "pending", "80", "84", "88", "", "96")
cleaned <- trimws(raw_scores)
cleaned[cleaned %in% c("pending", "")] <- NA_character_
scores <- as.numeric(cleaned)
print(scores)
print(typeof(scores))
print(sum(is.na(scores)))
print(mean(scores, na.rm = TRUE))
