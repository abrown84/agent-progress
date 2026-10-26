package com.brwnindustries.agentprogress.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.io.File

class UpdateCheckerTest {
    @Test
    fun sha256Hex_isStable() {
        val a = UpdateChecker.sha256Hex("agent-progress".toByteArray())
        val b = UpdateChecker.sha256Hex("agent-progress".toByteArray())
        assertEquals(a, b)
        assertEquals(64, a.length)
    }

    @Test
    fun sha256File_matchesBytes() {
        val tmp = File.createTempFile("ap-sha", ".bin")
        try {
            val payload = "hello-apk-bytes".toByteArray()
            tmp.writeBytes(payload)
            assertEquals(UpdateChecker.sha256Hex(payload), UpdateChecker.sha256File(tmp))
            assertNotEquals(UpdateChecker.sha256Hex("other".toByteArray()), UpdateChecker.sha256File(tmp))
        } finally {
            tmp.delete()
        }
    }
}
