score <- c(0, 59.5, 60, 79.9, 80, 100)
grade <- cut(score, breaks = c(0, 60, 80, 100), labels = c("C", "B", "A"),
             right = FALSE, include.lowest = TRUE)
print(grade)
print(table(grade))
