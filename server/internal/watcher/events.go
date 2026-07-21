package watcher

type Op string

const (
	OpCreate    Op = "create"
	OpWrite     Op = "write"
	OpRemove    Op = "remove"
	OpReconcile Op = "reconcile"
)

type Event struct {
	Path string `json:"path"`
	Op   Op     `json:"op"`
}

func merge(existing, incoming Op) Op {
	if incoming == OpRemove {
		return OpRemove
	}
	if incoming == OpCreate || existing == OpCreate {
		return OpCreate
	}
	return OpWrite
}
