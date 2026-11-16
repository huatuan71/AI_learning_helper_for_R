A <- matrix(c(4, 1, 0,
              1, 3, 0,
              0, 0, 2), nrow = 3)
e <- eigen(A, symmetric = TRUE)
print(round(e$values, 3))
print(all.equal(sum(e$values), sum(diag(A))))
print(all.equal(prod(e$values), det(A)))
resid <- A %*% e$vectors - e$vectors %*% diag(e$values)
print(max(abs(resid)) < 1e-10)
