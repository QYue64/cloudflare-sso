<template>
  <el-empty :description="description || title" class="empty-state" />
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>
