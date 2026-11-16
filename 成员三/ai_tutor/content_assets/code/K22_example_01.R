A <- matrix(c(2, 1, 1, 2), 2)
e <- eigen(A, symmetric = TRUE)
print(e$values)
s <- svd(A)
print(s$d)
print(s$u %*% diag(s$d) %*% t(s$v))
v1 <- e$vectors[, 1]
print(all.equal(as.vector(A %*% v1), e$values[1] * v1))
