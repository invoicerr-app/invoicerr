-- CreateTable
CREATE TABLE "PecFilenameSequence" (
    "idTrasmittente" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PecFilenameSequence_pkey" PRIMARY KEY ("idTrasmittente")
);
