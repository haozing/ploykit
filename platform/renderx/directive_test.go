package renderx

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

func TestDirectiveSinkSeqAndIsolation(t *testing.T) {
	s1 := NewSink()
	d1 := s1.Append("head", json.RawMessage(`[{"tag":"title","children":"a"}]`))
	d2 := s1.Append("status", json.RawMessage(`{"code":404}`))
	d3 := s1.Append("head", json.RawMessage(`[]`))
	if d1.Seq != 1 || d2.Seq != 2 || d3.Seq != 3 {
		t.Fatalf("seq = %d,%d,%d, want 1,2,3", d1.Seq, d2.Seq, d3.Seq)
	}

	s2 := NewSink()
	s2.Append("head", json.RawMessage(`[]`))
	if got := s2.Directives(); len(got) != 1 || got[0].Seq != 1 {
		t.Fatalf("第二个 sink 应从头计数：%v", got)
	}

	dirs := s1.Directives()
	dirs[0].Kind = "tampered"
	if s1.Directives()[0].Kind != "head" {
		t.Fatal("Directives() 应返回快照拷贝")
	}
}

func TestDirectiveSinkConcurrent(t *testing.T) {
	s := NewSink()
	var wg sync.WaitGroup
	for g := 0; g < 10; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				s.Append("head", nil)
			}
		}()
	}
	wg.Wait()
	dirs := s.Directives()
	if len(dirs) != 1000 {
		t.Fatalf("len = %d, want 1000", len(dirs))
	}
	seen := make(map[int]bool, len(dirs))
	for _, d := range dirs {
		if seen[d.Seq] {
			t.Fatalf("序号重复： %d", d.Seq)
		}
		seen[d.Seq] = true
	}
}

func TestHeadEntries(t *testing.T) {
	dirs := []Directive{
		{Kind: "status", Payload: json.RawMessage(`{"code":404}`), Seq: 1},
		{Kind: "head", Payload: json.RawMessage(
			`[{"tag":"title","children":"T"},{"tag":"meta","attrs":{"name":"description","content":"D"}}]`), Seq: 2},
		{Kind: "head", Payload: json.RawMessage(
			`[{"tag":"link","attrs":{"rel":"canonical","href":"/x"}}]`), Seq: 3},
	}
	entries, err := HeadEntries(dirs)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("len = %d, want 3", len(entries))
	}
	if entries[0].Tag != "title" || entries[0].Children != "T" {
		t.Errorf("entries[0] = %+v", entries[0])
	}
	if entries[1].Attrs["name"] != "description" || entries[1].Attrs["content"] != "D" {
		t.Errorf("entries[1] = %+v", entries[1])
	}
	if entries[2].Attrs["href"] != "/x" {
		t.Errorf("entries[2] = %+v", entries[2])
	}
}

func TestHeadEntriesMalformed(t *testing.T) {
	cases := []struct {
		name    string
		payload json.RawMessage
	}{
		{"对象非数组", json.RawMessage(`{"tag":"title"}`)},
		{"非法 JSON", json.RawMessage(`[{`)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := HeadEntries([]Directive{{Kind: "head", Payload: c.payload}})
			if !errors.Is(err, ErrInvalidDirective) {
				t.Fatalf("want ErrInvalidDirective, got %v", err)
			}
		})
	}
}
