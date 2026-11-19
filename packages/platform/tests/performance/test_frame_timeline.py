import unittest

from frame_timeline import is_flagged, present_unknown, split_layers


class ActivityBufferTests(unittest.TestCase):
    def test_one_display_frame_with_several_app_layers(self):
        package = "example.solid"
        activity = package + "/com.tns.NativeScriptActivity"

        def row(layer, buffer, present="On-time Present", display="42", time="1000"):
            return {
                "layer_name": layer,
                "is_buffer": buffer,
                "present_type": present,
                "jank_type": "None",
                "display_frame_token": display,
                "display_present_ns": time,
            }

        window = row("TX - " + activity + "#11", "Yes", "Late Present")
        dropped = row(activity + "#15", "Yes", "Dropped Frame", "-1", "[NULL]")
        transactions = [
            row("TX - SurfaceView[" + activity + "]#14", "No", "Late Present"),
            row(
                "TX - Background for SurfaceView[" + activity + "]#16",
                "No",
                "Late Present",
            ),
            row("TX - " + activity + "#11", "No"),
        ]
        child = row("SurfaceView[" + activity + "]#13", "Yes")
        frames, other, counts = split_layers(
            [window, *transactions, child, dropped], package
        )
        self.assertEqual(frames, [window, dropped])
        self.assertEqual(other, [*transactions, child])
        self.assertEqual(
            counts,
            {
                "matchedAppLayerRows": 6,
                "flaggedAppLayerRows": 4,
                "nonBufferTransactions": 3,
                "otherLayerBuffers": 1,
                "associatedDisplayFrames": 1,
                "displayFramesWithFlaggedAppLayers": 1,
            },
        )

    def test_a_frame_without_a_display_present_time_is_not_flagged_but_is_unknown(
        self,
    ):
        # What a device whose display HAL returns no usable present fence
        # records: the app frame looks early and unflagged.
        row = {
            "present_type": "Early Present",
            "jank_type": "SurfaceFlinger Scheduling",
            "display_present_type": "Unspecified Present",
        }
        self.assertFalse(is_flagged(row))
        self.assertTrue(present_unknown(row))
        self.assertFalse(
            present_unknown({**row, "display_present_type": "On-time Present"})
        )
        # Rows from before the column existed are not called unknown.
        self.assertFalse(present_unknown({"present_type": "On-time Present"}))

    def test_missing_buffer_metadata_cannot_verify_window_frames(self):
        with self.assertRaisesRegex(ValueError, "buffer classification"):
            split_layers([{"is_buffer": "[NULL]"}], "example.solid")


if __name__ == "__main__":
    unittest.main()
