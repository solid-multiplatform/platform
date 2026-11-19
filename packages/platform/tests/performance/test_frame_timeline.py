import unittest

from frame_timeline import (
    is_flagged,
    present_unknown,
    scene_surface_layer,
    split_layers,
    surface_cadence,
    surface_latches_query,
    surface_swaps_query,
)


class SurfaceViewCadenceTests(unittest.TestCase):
    VSYNC = 16_666_667

    def test_query_reads_the_app_surface_view_latches(self):
        sql = surface_latches_query("example.solid")
        self.assertIn("BufferTX - SurfaceView[", sql)
        self.assertIn("'example.solid/'", sql)
        self.assertIn("c.value > 0.5", sql)
        with self.assertRaisesRegex(ValueError, "Invalid trace package"):
            surface_latches_query("example.solid'; DROP TABLE slice")
        self.assertIn("eglSwapBuffers", surface_swaps_query())

    def test_frames_one_refresh_apart_are_not_lost(self):
        cadence = surface_cadence([i * self.VSYNC for i in range(5)])
        self.assertEqual(cadence["frames"], 5)
        self.assertEqual(cadence["motionIntervals"], 4)
        self.assertEqual(cadence["oneRefresh"], 4)
        self.assertEqual(cadence["framesLost"], 0)

    def test_a_two_refresh_interval_in_a_move_is_a_lost_frame(self):
        cadence = surface_cadence(
            [0, self.VSYNC, 3 * self.VSYNC, 4 * self.VSYNC]
        )
        self.assertEqual(cadence["twoRefreshes"], 1)
        self.assertEqual(cadence["framesLost"], 1)
        self.assertEqual(cadence["threeOrMore"], 0)

    def test_rests_between_moves_are_not_lost_frames(self):
        # 200 ms of rest between two moves: the long interval is not a gap.
        cadence = surface_cadence(
            [0, self.VSYNC, self.VSYNC + 200_000_000, self.VSYNC + 200_000_000 + self.VSYNC]
        )
        self.assertEqual(cadence["motionIntervals"], 2)
        self.assertEqual(cadence["framesLost"], 0)

    def test_scene_layer_is_chosen_by_gallery_frames_not_by_name(self):
        rows = [
            {"track_id": "1", "track_name": "BufferTX - SurfaceView[app/Act]#1", "ts": ts}
            for ts in (0, 16_666_667, 33_333_334)
        ] + [
            {"track_id": "2", "track_name": "BufferTX - SurfaceView[app/Act]#2", "ts": ts}
            for ts in (2_000_000_000, 2_041_666_667)
        ]
        name, times = scene_surface_layer(rows, lambda ts: ts < 1_000_000_000)
        self.assertEqual(name, "BufferTX - SurfaceView[app/Act]#1")
        self.assertEqual(times, [0, 16_666_667, 33_333_334])
        with self.assertRaisesRegex(ValueError, "No app SurfaceView"):
            scene_surface_layer([])


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
