items <- c("milk", "bread", "egg", "tea", "rice", "salt")
basket <- Matrix::sparseMatrix(i = c(1, 1, 2, 3, 4, 5, 5), j = c(1, 2, 1, 4, 2, 1, 6),
                               x = 1, dims = c(5, 6),
                               dimnames = list(paste0("C", 1:5), items))
print(Matrix::nnzero(basket))
print(round(Matrix::nnzero(basket) / prod(dim(basket)), 3))
buyers <- Matrix::colSums(basket)
print(buyers)
print(names(which.max(buyers)))
