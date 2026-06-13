<script setup lang="ts">
import { computed, watch } from "vue";
import { setModalOpen } from "../store";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    wide?: boolean;
    doc?: boolean;
  }>(),
  { wide: false, doc: false }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value)
});

watch(
  () => props.modelValue,
  (value) => setModalOpen(value),
  { immediate: true }
);
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :class="doc ? 'app-dialog-doc' : wide ? 'app-dialog-wide' : 'app-dialog-normal'"
    align-center
    append-to-body
    destroy-on-close
  >
    <slot />
  </el-dialog>
</template>
