package git

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/flux-pkm/server/internal/domain"
)

var (
	ErrNotRepository = errors.New("version control is not enabled for this vault")
	ErrMessageNeeded = errors.New("commit message is required")
	ErrInvalidPath   = errors.New("invalid Git path")
)

type CommandError struct{ Message string }

func (e *CommandError) Error() string { return e.Message }

func Status(ctx context.Context, root string) (domain.GitStatus, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return domain.GitStatus{Changes: []domain.GitChange{}}, nil
	}
	status := domain.GitStatus{Available: true, Changes: []domain.GitChange{}}
	top, err := run(ctx, root, "rev-parse", "--show-toplevel")
	if err != nil || !samePath(strings.TrimSpace(string(top)), root) {
		return status, nil
	}
	status.Initialized = true
	out, err := run(ctx, root, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--", ".", ":(exclude,top).flux/**")
	if err != nil {
		return domain.GitStatus{}, err
	}
	parseStatus(out, &status)
	return status, nil
}

func Enable(ctx context.Context, root string) error {
	if err := requireGit(); err != nil {
		return err
	}
	status, err := Status(ctx, root)
	if err != nil {
		return err
	}
	if !status.Initialized {
		if _, err := run(ctx, root, "init"); err != nil {
			return err
		}
	}
	return ensureIgnored(root, ".flux/")
}

func Stage(ctx context.Context, root string, paths []string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	args, err := pathArgs([]string{"add", "-A", "--"}, paths)
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		args = append(args, ".", ":(exclude,top).flux/**")
	}
	_, err = run(ctx, root, args...)
	return err
}

func Unstage(ctx context.Context, root string, paths []string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	if len(paths) == 0 {
		paths = []string{"."}
	}
	if _, err := run(ctx, root, "rev-parse", "--verify", "HEAD"); err != nil {
		args, pathErr := pathArgs([]string{"rm", "--cached", "-r", "--ignore-unmatch", "--"}, paths)
		if pathErr != nil {
			return pathErr
		}
		_, err = run(ctx, root, args...)
		return err
	}
	args, err := pathArgs([]string{"reset", "--quiet", "HEAD", "--"}, paths)
	if err != nil {
		return err
	}
	_, err = run(ctx, root, args...)
	return err
}

func Commit(ctx context.Context, root, message string, paths []string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return ErrMessageNeeded
	}
	if len(paths) > 0 {
		if err := Stage(ctx, root, paths); err != nil {
			return err
		}
	} else if err := requireRepository(ctx, root); err != nil {
		return err
	}
	_, err := run(ctx, root, "commit", "-m", message)
	return err
}

func Pull(ctx context.Context, root string) error {
	return repositoryCommand(ctx, root, "pull", "--ff-only")
}

func Push(ctx context.Context, root string) error {
	return repositoryCommand(ctx, root, "push")
}

func Fetch(ctx context.Context, root string) error {
	return repositoryCommand(ctx, root, "fetch", "--prune")
}

func Diff(ctx context.Context, root, path string, staged bool) (domain.GitDiff, error) {
	if err := requireRepository(ctx, root); err != nil {
		return domain.GitDiff{}, err
	}
	paths, err := pathArgs(nil, []string{path})
	if err != nil {
		return domain.GitDiff{}, err
	}
	args := []string{"diff", "--no-ext-diff", "--unified=3"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--")
	args = append(args, paths...)
	out, err := run(ctx, root, args...)
	if err != nil {
		return domain.GitDiff{}, err
	}
	const maxDiffBytes = 1 << 20
	if len(out) > maxDiffBytes {
		out = append(out[:maxDiffBytes], []byte("\n… diff truncated by Flux\n")...)
	}
	return domain.GitDiff{Path: path, Staged: staged, Content: string(out)}, nil
}

func repositoryCommand(ctx context.Context, root string, args ...string) error {
	if err := requireRepository(ctx, root); err != nil {
		return err
	}
	_, err := run(ctx, root, args...)
	return err
}

func requireGit() error {
	if _, err := exec.LookPath("git"); err != nil {
		return &CommandError{Message: "Git is not installed"}
	}
	return nil
}

func requireRepository(ctx context.Context, root string) error {
	status, err := Status(ctx, root)
	if err != nil {
		return err
	}
	if !status.Available {
		return &CommandError{Message: "Git is not installed"}
	}
	if !status.Initialized {
		return ErrNotRepository
	}
	return nil
}

func run(ctx context.Context, root string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, "git", args...)
	command.Dir = root
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var stderr bytes.Buffer
	command.Stderr = &stderr
	out, err := command.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, &CommandError{Message: message}
	}
	return out, nil
}

func parseStatus(out []byte, status *domain.GitStatus) {
	records := bytes.Split(out, []byte{0})
	for index := 0; index < len(records); index++ {
		record := string(records[index])
		switch {
		case strings.HasPrefix(record, "# branch.head "):
			status.Branch = strings.TrimPrefix(record, "# branch.head ")
		case strings.HasPrefix(record, "# branch.upstream "):
			status.Upstream = strings.TrimPrefix(record, "# branch.upstream ")
		case strings.HasPrefix(record, "# branch.ab "):
			fields := strings.Fields(record)
			if len(fields) == 4 {
				status.Ahead, _ = strconv.Atoi(strings.TrimPrefix(fields[2], "+"))
				status.Behind, _ = strconv.Atoi(strings.TrimPrefix(fields[3], "-"))
			}
		case strings.HasPrefix(record, "1 "):
			appendChange(status, strings.SplitN(record, " ", 9), 8, "")
		case strings.HasPrefix(record, "2 "):
			original := ""
			if index+1 < len(records) {
				index++
				original = string(records[index])
			}
			appendChange(status, strings.SplitN(record, " ", 10), 9, original)
		case strings.HasPrefix(record, "u "):
			appendChange(status, strings.SplitN(record, " ", 11), 10, "")
		case strings.HasPrefix(record, "? "):
			status.Changes = append(status.Changes, domain.GitChange{Path: strings.TrimPrefix(record, "? "), IndexStatus: "?", WorktreeStatus: "?"})
		}
	}
}

func appendChange(status *domain.GitStatus, fields []string, pathIndex int, original string) {
	if len(fields) <= pathIndex || len(fields[1]) != 2 {
		return
	}
	status.Changes = append(status.Changes, domain.GitChange{
		Path: fields[pathIndex], OriginalPath: original,
		IndexStatus: fields[1][:1], WorktreeStatus: fields[1][1:],
	})
}

func pathArgs(prefix, paths []string) ([]string, error) {
	result := append([]string(nil), prefix...)
	for _, value := range paths {
		value = filepath.ToSlash(value)
		if value == "." {
			result = append(result, value)
			continue
		}
		if value == "" || value != filepath.ToSlash(filepath.Clean(value)) || filepath.IsAbs(value) || value == ".." || strings.HasPrefix(value, "../") || value == ".flux" || strings.HasPrefix(value, ".flux/") || strings.ContainsRune(value, 0) {
			return nil, ErrInvalidPath
		}
		result = append(result, ":(top,literal)"+value)
	}
	return result, nil
}

func samePath(a, b string) bool {
	resolvedA, errA := filepath.EvalSymlinks(a)
	resolvedB, errB := filepath.EvalSymlinks(b)
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return filepath.Clean(resolvedA) == filepath.Clean(resolvedB)
}

func ensureIgnored(root, line string) error {
	path := filepath.Join(root, ".gitignore")
	content, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, candidate := range strings.Split(string(content), "\n") {
		if strings.TrimSpace(candidate) == line {
			return nil
		}
	}
	if len(content) > 0 && content[len(content)-1] != '\n' {
		content = append(content, '\n')
	}
	content = append(content, line...)
	content = append(content, '\n')
	return os.WriteFile(path, content, 0o644)
}
