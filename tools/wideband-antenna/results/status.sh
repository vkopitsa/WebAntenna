#!/bin/bash
# one line: best cost and generation of every split-study run (runAB.sh)
cd "$(dirname "$0")"
line="$(date +%H:%M)"
for f in opt_*.jsonl; do t=${f#opt_}; t=${t%.jsonl}; case " $* " in *" $t "*) ;; *) [ $# -gt 0 ] && continue ;; esac
  line="$line $t:$(tail -1 $f | python3 -c 'import sys,json;d=json.loads(sys.stdin.read());print("it%d best%.2f" % (d["it"], d["best"]))')"; done
for f in rand_*.jsonl; do t=${f#rand_}; t=${t%.jsonl}; case " $* " in *" $t "*) ;; *) [ $# -gt 0 ] && continue ;; esac
  line="$line $t:$(wc -l < $f)smp"; done
[ -f runAB.done ] && line="$line DONE"
echo "$line"
