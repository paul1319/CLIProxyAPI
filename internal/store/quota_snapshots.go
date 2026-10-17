package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/quota"
)

// QuotaSnapshotStore keeps management observations outside credential watcher directories.
type QuotaSnapshotStore struct{ Path string }

type quotaSnapshotFile struct {
	Version int                     `json:"version"`
	Records map[string]quota.Record `json:"records"`
}

const maxQuotaSnapshotBytes = 16 << 20

func (s *QuotaSnapshotStore) Load() (map[string]quota.Record, error) {
	file, errOpen := os.Open(s.Path)
	if errors.Is(errOpen, os.ErrNotExist) {
		return nil, nil
	}
	if errOpen != nil {
		return nil, fmt.Errorf("open quota snapshots: %w", errOpen)
	}
	data, errRead := io.ReadAll(io.LimitReader(file, maxQuotaSnapshotBytes+1))
	errClose := file.Close()
	if errRead != nil || errClose != nil {
		return nil, fmt.Errorf("read quota snapshots: %w", errors.Join(errRead, errClose))
	}
	if len(data) > maxQuotaSnapshotBytes {
		return nil, errors.New("quota snapshot file exceeds size limit")
	}
	var contents quotaSnapshotFile
	if errDecode := json.Unmarshal(data, &contents); errDecode != nil || contents.Version != 1 {
		return nil, errors.New("invalid quota snapshot file or version")
	}
	return contents.Records, nil
}

func (s *QuotaSnapshotStore) Save(records map[string]quota.Record) (err error) {
	data, errEncode := json.Marshal(quotaSnapshotFile{Version: 1, Records: records})
	if errEncode != nil {
		return fmt.Errorf("encode quota snapshots: %w", errEncode)
	}
	if len(data) > maxQuotaSnapshotBytes {
		return errors.New("quota snapshots exceed size limit")
	}
	dir := filepath.Dir(s.Path)
	if errMkdir := os.MkdirAll(dir, 0o700); errMkdir != nil {
		return fmt.Errorf("create quota snapshot directory: %w", errMkdir)
	}
	file, errCreate := os.CreateTemp(dir, ".quota-*")
	if errCreate != nil {
		return fmt.Errorf("create quota snapshot file: %w", errCreate)
	}
	temporary := file.Name()
	defer func() {
		if errRemove := os.Remove(temporary); errRemove != nil && !errors.Is(errRemove, os.ErrNotExist) {
			err = errors.Join(err, fmt.Errorf("remove quota temporary file: %w", errRemove))
		}
	}()
	_, errWrite := file.Write(data)
	if errWrite == nil {
		errWrite = file.Sync()
	}
	errClose := file.Close()
	if errWrite != nil || errClose != nil {
		return fmt.Errorf("write quota snapshots: %w", errors.Join(errWrite, errClose))
	}
	if errRename := os.Rename(temporary, s.Path); errRename != nil {
		return fmt.Errorf("replace quota snapshots: %w", errRename)
	}
	if runtime.GOOS != "windows" {
		directory, errOpen := os.Open(dir)
		if errOpen != nil {
			return fmt.Errorf("open quota snapshot directory: %w", errOpen)
		}
		errSync := directory.Sync()
		errCloseDirectory := directory.Close()
		if errSync != nil || errCloseDirectory != nil {
			return fmt.Errorf("sync quota snapshot directory: %w", errors.Join(errSync, errCloseDirectory))
		}
	}
	return nil
}
