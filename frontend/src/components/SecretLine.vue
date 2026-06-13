<script setup lang="ts">
import { ref } from "vue";
import { Eye } from "lucide-vue-next";
import { toast } from "../store";

const props = defineProps<{
  label: string;
  value: string;
  masked?: boolean;
}>();

const revealed = ref(!props.masked);

async function handleClick() {
  if (props.masked && !revealed.value) {
    revealed.value = true;
    toast("已显示，再点一次可复制");
    return;
  }
  if (!props.value) return;
  await navigator.clipboard?.writeText(props.value);
  toast("已复制");
}
</script>

<template>
  <button type="button" class="copy-line" @click="handleClick">
    <span class="copy-line-label">{{ label }}</span>
    <code class="copy-line-value">{{ revealed ? value : "********" }}</code>
    <Eye v-if="masked && !revealed" :size="16" />
  </button>
</template>
