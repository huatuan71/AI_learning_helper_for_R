raw_scores <- c("55", "60", " 65 ", "70", "75", "80", "85", "90", "95", "absent")
cleaned <- trimws(raw_scores)
cleaned[cleaned == "absent"] <- NA_character_
scores <- as.numeric(cleaned)
print(typeof(raw_scores))
print(typeof(scores))
print(scores)
print(sum(is.na(scores)))
