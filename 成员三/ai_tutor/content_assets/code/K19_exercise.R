sales <- matrix(c(12, 15, 11, 14,
                  20, 18, 22, 25,
                   9, 10, 12, 11), nrow = 3, byrow = TRUE,
                dimnames = list(c("North", "South", "West"), c("Q1", "Q2", "Q3", "Q4")))
print(sales)
print(sales[, "Q2", drop = FALSE])
print(sales["South", "Q4"])
print(c(rows = nrow(sales), cols = ncol(sales)))
