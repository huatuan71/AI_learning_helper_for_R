X <- matrix(c(5, 4, 1, 1,
              4, 5, 1, 2,
              1, 1, 5, 4), nrow = 4)
s <- svd(X)
print(c(dim(s$u), length(s$d), dim(s$v)))
print(round(s$d, 3))
share <- s$d^2 / sum(s$d^2)
print(round(share, 3))
