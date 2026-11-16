id <- 1:12
group <- rep(c("control", "treat"), each = 6)
print(table(group))
set.seed(2026)
train <- sample(id, 8)
test <- setdiff(id, train)
print(c(train = length(train), test = length(test), overlap = length(intersect(train, test))))
set.seed(2026)
print(identical(train, sample(id, 8)))
