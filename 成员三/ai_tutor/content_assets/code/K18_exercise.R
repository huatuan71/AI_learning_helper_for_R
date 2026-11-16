name <- c(" Alpha 15 ", "Beta  60 Pro", "unknown", "GAMMA 14", "")
clean <- gsub("\\s+", " ", trimws(name))
model <- sub("^.* ([0-9]+).*$", "\\1", clean)
model[!grepl("[0-9]", clean)] <- NA
print(clean)
print(model)
print(sum(is.na(model)))
