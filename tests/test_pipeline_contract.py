import json
import unittest
from pathlib import Path
from unittest.mock import patch

import scripts.pipeline_runtime as runtime
from scripts.pipeline_runtime import (
    CREDENTIAL_SOURCES,
    EXECUTION_MODES,
    KNOWN_PIPELINE_NAMES,
    KNOWN_PIPELINE_TASK_STAGES,
    PIPELINE_CONTRACT_VERSION,
    PIPELINE_RUN_STATUSES,
    PIPELINE_TASK_STATUSES,
    _stable_json,
    hash_payload,
    make_cost_event_key,
    make_pipeline_run_key,
    make_pipeline_task_key,
)


ROOT = Path(__file__).resolve().parents[1]


class PipelineContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(
            (ROOT / "contracts/pipeline-contract-v1.json").read_text(encoding="utf-8")
        )

    def test_enum_vocabulary_matches(self) -> None:
        self.assertEqual(PIPELINE_CONTRACT_VERSION, self.contract["version"])
        self.assertEqual(list(PIPELINE_RUN_STATUSES), self.contract["runStatuses"])
        self.assertEqual(list(PIPELINE_TASK_STATUSES), self.contract["taskStatuses"])
        self.assertEqual(list(CREDENTIAL_SOURCES), self.contract["credentialSources"])
        self.assertEqual(list(EXECUTION_MODES), self.contract["executionModes"])
        self.assertEqual(list(KNOWN_PIPELINE_NAMES), self.contract["pipelineNames"])
        self.assertEqual(
            list(KNOWN_PIPELINE_TASK_STAGES), self.contract["taskStages"]
        )

    def test_golden_keys_match(self) -> None:
        fixture = self.contract["keyFixture"]
        expected = fixture["expected"]
        run_key = make_pipeline_run_key(
            fixture["pipeline"], fixture["businessDate"], fixture["runExtra"]
        )
        task_key = make_pipeline_task_key(
            pipeline=fixture["pipeline"],
            run_key=run_key,
            stage=fixture["stage"],
            payload=fixture["payload"],
        )
        self.assertEqual(_stable_json(fixture["payload"]), expected["stablePayload"])
        self.assertEqual(hash_payload(fixture["payload"]), expected["payloadHash"])
        self.assertEqual(run_key, expected["runKey"])
        self.assertEqual(task_key, expected["taskKey"])
        self.assertEqual(
            make_cost_event_key(
                run_id=fixture["runId"],
                provider=fixture["provider"],
                endpoint=fixture["endpoint"],
                idempotency_key=task_key,
            ),
            expected["costEventKey"],
        )

    def test_python_cost_writer_carries_explicit_attribution(self) -> None:
        previous = dict(runtime._CURRENT_RUN)
        runtime._CURRENT_RUN.clear()
        runtime._CURRENT_RUN.update({"run_id": "run-1", "name": "test"})
        self.addCleanup(runtime._CURRENT_RUN.update, previous)
        self.addCleanup(runtime._CURRENT_RUN.clear)

        with patch.object(runtime, "_d1_execute") as execute:
            runtime.record_cost_event(
                provider="openrouter",
                endpoint="chat",
                unit_type="request",
                unit_count=1,
                credential_source="user",
                execution_mode="byok",
                owner_id="user-1",
                idempotency_key="request-1",
            )

        sql, params = execute.call_args.args
        self.assertIn("credential_source, execution_mode", sql)
        self.assertEqual(params[14:17], ["user", "byok", "user-1"])


if __name__ == "__main__":
    unittest.main()
