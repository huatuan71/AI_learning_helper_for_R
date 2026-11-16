s <- Matrix::sparseMatrix(i = c(1, 3), j = c(1, 2), x = c(5, 7), dims = c(3, 3))
print(s)
print(as.matrix(s))
print(Matrix::nnzero(s))
