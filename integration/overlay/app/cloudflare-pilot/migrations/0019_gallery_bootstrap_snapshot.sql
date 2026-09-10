-- Additive, staging-first. Never apply against a remote binding without owner approval.
CREATE TABLE IF NOT EXISTS GalleryBootstrapSnapshot (
 cohortHash TEXT PRIMARY KEY NOT NULL,
 experimentId TEXT NOT NULL,
 manifestJson TEXT NOT NULL,
 createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (experimentId) REFERENCES ElementExperiment(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS GalleryBootstrapSnapshot_experiment ON GalleryBootstrapSnapshot(experimentId);
CREATE TABLE IF NOT EXISTS GalleryBootstrapLock (
 experimentId TEXT PRIMARY KEY NOT NULL,
 owner TEXT NOT NULL,
 expiresAt INTEGER NOT NULL DEFAULT 0
);
