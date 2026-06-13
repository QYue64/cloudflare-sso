<script setup lang="ts">
import { watch } from "vue";
import { ElMessage } from "element-plus";
import { appState } from "../store";

watch(
  () => appState.message,
  (value) => {
    if (!value) return;
    ElMessage({
      message: value,
      type: appState.messageType,
      grouping: true,
      showClose: true
    });
  }
);
</script>

<template>
  <span hidden />
</template>
