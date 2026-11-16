age <- c(17, 18, 25, 35, 36, 59, 60, 75)
group <- cut(age, breaks = c(-Inf, 18, 36, 60, Inf),
             labels = c("under18", "18-35", "36-59", "60plus"), right = FALSE)
print(table(group))
print(as.character(group[age %in% c(18, 36, 60)]))
print(anyNA(group))
