sales <- array(c(10, 12, 11, 15, 9, 14,
                 5, 6, 7, 6, 8, 9),
               dim = c(2, 3, 2),
               dimnames = list(c("A", "B"), c("Jan", "Feb", "Mar"), c("tea", "cake")))
print(sales[, , "tea"])
print(apply(sales, 1, sum))
print(apply(sales, 3, sum))
print(apply(sales, c(1, 3), sum))
