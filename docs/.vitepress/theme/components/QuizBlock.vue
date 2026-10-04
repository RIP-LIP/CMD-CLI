<script setup lang="ts">
/**
 * 配套练习：选择题 + 填空题，提交后判分并显示解析。
 *
 * 题目从 lib/quiz-data 按 moduleId 取，页面里只写一句 <QuizBlock module-id="01-intro" />。
 *
 * 通过线 60 分。达到才记完成并授予徽章；低于只记一次作答，不解锁。
 * 判分与写进度都走 store.markDone / recordAttempt —— 三条完成路径幂等。
 */
import { ref, computed } from 'vue'
import { recordAttempt, markDone, getRecord } from '../../lib/store'
import { QUIZZ } from '../../lib/quiz-data'
import { indexById } from '../../data/modules'

const props = defineProps<{ moduleId: string }>()

const def = computed(() => indexById(props.moduleId))
const questions = computed(() => QUIZZ[props.moduleId] ?? [])

const answers = ref<Record<number, string>>({})
const graded = ref(false)
const result = ref({ correct: 0, total: 0, score: 0, passed: false })
const best = ref(0)

function isCorrect(i: number): boolean {
  const q = questions.value[i]
  const given = answers.value[i]
  if (!q || given === undefined || given === '') return false
  if (q.type === 'choice') return Number(given) === Number(q.answer)
  const accepted = [String(q.answer), ...(q.answerAlt ?? [])].map(norm)
  return accepted.includes(norm(given))
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function submit() {
  const total = questions.value.length
  if (!total) return
  let correct = 0
  questions.value.forEach((_, i) => { if (isCorrect(i)) correct++ })
  const score = Math.round((correct / total) * 100)
  const passed = score >= 60

  result.value = { correct, total, score, passed }
  graded.value = true

  if (!def.value) return
  if (passed) {
    const st = markDone(def.value.track, props.moduleId, score, def.value.badge)
    best.value = st.modules[props.moduleId]?.bestScore ?? score
  } else {
    const st = recordAttempt(def.value.track, props.moduleId, score)
    best.value = st.modules[props.moduleId]?.bestScore ?? 0
  }
}

function redo() {
  answers.value = {}
  graded.value = false
}

const optLetter = (i: number) => String.fromCharCode(65 + i)
</script>

<template>
  <section v-if="questions.length" class="quiz">
    <h2 style="margin-top: 0">📝 配套练习</h2>
    <p style="font-size: 14px; color: var(--vp-c-text-2); margin-top: 0">
      {{ questions.length }} 题，满分 100，60 分及格。提交后每题都会给解析。
    </p>

    <div v-for="(q, i) in questions" :key="i" class="quiz-q">
      <div class="q-head">
        <span class="q-num">{{ q.type === 'choice' ? 'Q' : 'FILL' }}{{ String(i + 1).padStart(2, '0') }}</span>
        <span>{{ q.q }}</span>
      </div>

      <ul v-if="q.type === 'choice'" class="quiz-opts">
        <li v-for="(o, k) in q.opts ?? []" :key="k" style="list-style: none">
          <label
            :class="{
              sel: answers[i] === String(k) && !graded,
              right: graded && Number(q.answer) === k,
              wrong: graded && answers[i] === String(k) && Number(q.answer) !== k,
            }"
            @click.prevent="graded ? null : (answers[i] = String(k))"
          >
            <input
              type="radio" :name="`q${i}`" :checked="answers[i] === String(k)"
              :disabled="graded" style="margin-top: 4px"
            />
            <span class="opt-key">{{ optLetter(k) }}.</span>
            <span>{{ o }}</span>
          </label>
        </li>
      </ul>

      <div v-else class="quiz-fill">
        <span v-if="q.prefix" style="color: var(--vp-c-text-3)">{{ q.prefix }}</span>
        <input
          v-model="answers[i]" type="text" :disabled="graded"
          placeholder="填命令片段" autocomplete="off" spellcheck="false"
        />
        <span v-if="q.suffix" style="color: var(--vp-c-text-3)">{{ q.suffix }}</span>
      </div>

      <div v-if="graded" class="quiz-result" :class="isCorrect(i) ? 'ok' : 'no'">
        <div v-if="isCorrect(i)">✓ 回答正确</div>
        <div v-else>
          ✗ 正确答案：
          <code v-if="q.type === 'choice'">{{ optLetter(Number(q.answer)) }}. {{ q.opts?.[Number(q.answer)] }}</code>
          <code v-else>{{ q.prefix }} {{ q.answer }}</code>
        </div>
        <div class="why">{{ q.explain }}</div>
      </div>
    </div>

    <div class="quiz-actions">
      <button class="primary" @click="submit">提交答案</button>
      <button @click="redo">重做</button>
      <span v-if="graded" class="quiz-score">
        本次 {{ result.correct }}/{{ result.total }} · {{ result.score }} 分
        <template v-if="result.passed">（已记为完成）</template>
        <template v-else>（未过 60 分，再来一次）</template>
      </span>
      <span v-else-if="best" class="quiz-score">历史最高 {{ best }} 分</span>
    </div>
  </section>
</template>
