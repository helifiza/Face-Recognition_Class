from datetime import date, time
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Student(Input):
    student_id: str = Field(min_length=1, max_length=100)
    full_name: str = Field(min_length=1, max_length=200)
    class_name: str | None = None
    faculty: str | None = None
    email: str | None = None


class StudentUpdate(Input):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    class_name: str | None = Field(default=None, max_length=200)
    faculty: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=254)
    status: Literal["ACTIVE", "INACTIVE"] | None = None

    @model_validator(mode="after")
    def check_update(self):
        if not self.model_fields_set:
            raise ValueError("Supply at least one field to update")
        for field in ("full_name", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Course(Input):
    course_id: str = Field(min_length=1, max_length=100)
    course_name: str = Field(min_length=1, max_length=200)
    lecturer: str | None = None


class Enrollment(Input):
    student_id: str
    course_id: str


class ClassSession(Input):
    course_id: str
    session_date: date
    start_time: time
    end_time: time
    room: str | None = None

    @model_validator(mode="after")
    def check_times(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SessionStatus(Input):
    status: Literal["SCHEDULED", "OPEN", "CLOSED"]


class VectorQuery(Input):
    embedding: list[float] = Field(min_length=512, max_length=512)
    limit: int = Field(default=5, ge=1, le=100)
