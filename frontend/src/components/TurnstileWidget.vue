<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  siteKey: string;
}>();

const emit = defineEmits<{
  (e: "verify", token: string): void;
}>();

const widgetId = ref<string | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const scriptLoaded = ref(false);

function loadTurnstileScript() {
  if (document.querySelector('script[src*="challenges.cloudflare.com"]')) {
    scriptLoaded.value = true;
    renderWidget();
    return;
  }

  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    scriptLoaded.value = true;
    renderWidget();
  };
  document.head.appendChild(script);
}

function renderWidget() {
  if (!containerRef.value || !props.siteKey || !scriptLoaded.value) return;
  const turnstile = (window as any).turnstile;
  if (!turnstile) {
    setTimeout(renderWidget, 100);
    return;
  }

  try {
    widgetId.value = turnstile.render(containerRef.value, {
      sitekey: props.siteKey,
      callback: (token: string) => {
        emit("verify", token);
      },
      theme: "light"
    });
  } catch (error) {
    console.error("Turnstile render failed:", error);
  }
}

function reset() {
  const turnstile = (window as any).turnstile;
  if (widgetId.value !== null && turnstile) {
    turnstile.reset(widgetId.value);
  }
}

watch(() => props.siteKey, () => {
  if (props.siteKey) {
    loadTurnstileScript();
  }
});

onMounted(() => {
  if (props.siteKey) {
    loadTurnstileScript();
  }
});

defineExpose({ reset });
</script>

<template>
  <div ref="containerRef" class="turnstile-widget"></div>
</template>

<style scoped>
.turnstile-widget {
  display: flex;
  justify-content: center;
  margin: 16px 0;
}
</style>
